// Service worker водителя: web-push (этап 5) + офлайн-кэш оболочки приложения (офлайн-режим).
// Рукописный, без Serwist: Serwist на Next 16 требует webpack-сборки и смены tsconfig на webworker
// (ломает типы React-проекта) — для нашего сценария избыточно. Здесь — лёгкий рантайм-кэш через
// Cache API: статические чанки Next кэшируются cache-first (они хэшированы → безопасно), навигация —
// network-first с откатом в кэш, чтобы при холодном старте без сети приложение всё равно открылось.
// Данные (список/карточка) офлайн отдаёт слой приложения (IndexedDB + cachedFetcher), не SW.
// ВНИМАНИЕ: это рантайм service worker (область self/clients), а не модуль приложения.

// Версия кэша (O9): sw-version.js генерит prebuild-скрипт (public/sw-version.js, git sha / timestamp
// сборки). Имя кэша меняется при каждом деплое → activate удаляет прошлый кэш, устаревшие чанки Next
// не копятся. В dev файла нет → importScripts бросает → версия "dev".
try {
  importScripts("/sw-version.js");
} catch (e) {
  /* dev: файла нет — остаёмся на "dev" */
}
const VERSION = self.SW_VERSION || "dev";
const CACHE = "vanmark-app-" + VERSION;
const PRECACHE_ICONS = ["/icons/icon-192.png", "/icons/icon-512.png"];
const SHELL_URL = "/m"; // оболочка «Мои задачи» — запасной экран холодного старта
const MAX_NAV_ENTRIES = 30; // потолок навигационных HTML-записей (LRU-обрезка)
// Кэш фото/актов (O10). Отдельное СТАБИЛЬНОЕ имя (не привязано к версии сборки): вложения иммутабельны
// по uuid, чистить их при каждом деплое незачем. activate удаляет только старые app-кэши, этот не трогает.
const PHOTO_CACHE = "vanmark-photos-v1";
const MAX_PHOTOS = 100; // потолок кэшированных вложений (~30–50 МБ на телефоне)

// В dev (localhost) кэш оболочки ОТКЛЮЧЁН: иначе cache-first отдавал бы устаревшие чанки и ломал HMR.
// На проде (боевой домен) кэш включён — ради холодного старта без сети. Для e2e с реальным SW на
// localhost его включает флаг ?cache=on в URL регистрации (O9): self.location — это URL самого sw.js.
const CACHE_ENABLED =
  (self.location.hostname !== "localhost" && self.location.hostname !== "127.0.0.1") ||
  self.location.search.includes("cache=on");

// Не кэшируем страницу логина под ключом оболочки: если SW встал ДО входа, неавторизованный запрос
// /m редиректит на /login, и офлайн-фолбэк отдавал бы логин-тупик. Кэшируем только «настоящие»
// ответы навигаций (200, без редиректа, не на /login).
function isCacheableNav(res, url) {
  return res && res.ok && !res.redirected && !url.pathname.startsWith("/login");
}

self.addEventListener("install", (event) => {
  if (!CACHE_ENABLED) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE_ICONS).catch(() => {}); // иконки статичны — best-effort
      await warmShell(cache); // оболочку кладём отдельно, с проверкой на логин-редирект
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Держим ДВЕ последние версии оболочки: текущую и одну предыдущую (инцидент 07.07). При деплое
      // открытая вкладка какое-то время остаётся на старом BUILD_ID — до перезагрузки по смене
      // контроллера (см. src/lib/offline/sw-update.ts) — и ещё может запросить хэш-чанки прошлой
      // сборки. Они лежат в предыдущем кэше, поэтому навигация не падает в 404, даже если reload
      // запоздал или не сработал (напр. в TWA). Более старые app-кэши удаляем. Фото-кэш
      // (vanmark-photos-*) и легаси vanmark-v1 не трогаем: фото иммутабельны.
      const appCaches = (await caches.keys()).filter((k) => k.startsWith("vanmark-app-"));
      const prev = appCaches.filter((k) => k !== CACHE).slice(-1); // самый свежий из прошлых (порядок keys() ≈ вставка)
      const keep = new Set([CACHE, ...prev]);
      await Promise.all(appCaches.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (!CACHE_ENABLED) return; // dev — ничего не перехватываем
  const req = event.request;
  if (req.method !== "GET") return; // мутации не кэшируем
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // сторонние — мимо
  // Фото/акты (O10): раздаются через /api/attachments/:id, иммутабельны по uuid — cache-first в
  // отдельный кэш, чтобы уже просмотренные вложения открывались офлайн. ДО общего пропуска /api.
  if (url.pathname.startsWith("/api/attachments/")) {
    event.respondWith(photoCache(req));
    return;
  }
  if (url.pathname.startsWith("/api/")) return; // прочие данные кэширует приложение (IndexedDB), не SW

  // Хэшированная статика Next и иконки — cache-first (контент иммутабелен по имени).
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Логин — только сеть, без фолбэка на оболочку: офлайн вход всё равно невозможен, а отдавать
  // вместо формы закэшированную оболочку — сбивать с толку.
  if (req.mode === "navigate" && url.pathname.startsWith("/login")) return;
  // Навигация (открытие страниц) — network-first с откатом в кэш (холодный старт без сети).
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, url));
    return;
  }
});

async function cacheFirst(req) {
  // Ищем во ВСЕХ кэшах (текущий + предыдущий app-кэш), а не только в текущем: при деплое старый
  // клиент, ещё живущий в памяти вкладки, может запросить хэш-чанк прошлой сборки — отдаём его из
  // предыдущего кэша, чтобы навигация не упала в 404 до перезагрузки (инцидент 07.07). Хэш в имени
  // файла гарантирует, что контент не перепутается между версиями. Вызывается только для
  // /_next/static/ и /icons/ — эти пути не пересекаются с фото-кэшем (/api/attachments/).
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

// Фото/акт (O10): cache-first в отдельный кэш с LRU-обрезкой. Приватность не ослабляется — в кэш
// попадают только ответы, уже выданные сервером ЭТОМУ пользователю (проверка прав на сервере),
// и живут на его телефоне, как IndexedDB. Промах офлайн → fetch упадёт, <img> просто не покажется
// (как было до кэша) — непрогретые вложения офлайн недоступны, это ожидаемо.
async function photoCache(req) {
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    cache.put(req, res.clone());
    trimPhotos(cache);
  }
  return res;
}

async function trimPhotos(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_PHOTOS;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]); // порядок keys() ≈ вставка → грубый FIFO
}

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (isCacheableNav(res, new URL(res.url))) {
      cache.put(req, res.clone());
      trimNavigations(cache); // не ждём — фоновая обрезка
    }
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    const home = await cache.match(SHELL_URL); // запасной экран — список «Мои задачи»
    if (home) return home;
    throw e;
  }
}

// Перекэшировать оболочку /m «настоящим» ответом (не логин-редиректом). Вызывается при install и по
// сообщению warm-shell из приложения (после входа — тогда /m точно отдаёт оболочку, а не редирект).
async function warmShell(cache) {
  try {
    const res = await fetch(SHELL_URL, { redirect: "follow" });
    if (isCacheableNav(res, new URL(res.url))) await cache.put(SHELL_URL, res.clone());
  } catch (e) {
    /* нет сети при install — оболочка ляжет позже, из networkFirst или warm-shell */
  }
}

// Навигационные записи (HTML) — не статика/иконки. Держим не больше MAX_NAV_ENTRIES: при переполнении
// удаляем самые старые (порядок keys() ≈ порядок вставки — грубый FIFO, достаточно для масштаба).
async function trimNavigations(cache) {
  const keys = await cache.keys();
  const nav = keys.filter((r) => {
    const p = new URL(r.url).pathname;
    return !p.startsWith("/_next/static/") && !p.startsWith("/icons/");
  });
  const excess = nav.length - MAX_NAV_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(nav[i]);
}

self.addEventListener("message", (event) => {
  if (!CACHE_ENABLED) return; // dev — прогрев кэша не нужен (fetch всё равно не перехватываем)
  const data = event.data || {};
  if (data.type === "warm-shell") {
    event.waitUntil(caches.open(CACHE).then((c) => warmShell(c)));
  }
  // Прогрев HTML карточек (O10): приложение прислало список URL видимых задач — кэшируем их навигации,
  // чтобы офлайн-переход открывал карточку, а не фолбэк-оболочку. Та же проверка, что в networkFirst.
  if (data.type === "warm-pages" && Array.isArray(data.urls)) {
    event.waitUntil(warmPages(data.urls));
  }
});

async function warmPages(urls) {
  const cache = await caches.open(CACHE);
  for (const u of urls.slice(0, MAX_NAV_ENTRIES)) {
    try {
      const res = await fetch(u, { redirect: "follow" });
      if (isCacheableNav(res, new URL(res.url))) await cache.put(u, res.clone());
    } catch (e) {
      /* нет сети — пропускаем, прогреется в следующий раз */
    }
  }
  await trimNavigations(cache);
}

// Пришёл пуш — показываем уведомление. Payload собирает сервер (src/domain/notifications.ts).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "VanMark", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "VanMark";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      data: { url: data.url || "/" },
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      lang: "ru",
      renotify: Boolean(data.tag),
    }),
  );
});

// Тап по уведомлению — фокусируем уже открытое окно карточки или открываем новое.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin).href;
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});

// ——— Background Sync: досылка очереди при свёрнутом приложении (O11) ———
// Когда водитель завершил задачу без связи и убрал телефон в карман, действие должно уйти на сервер
// само, как только появится сеть — даже если PWA закрыта. Браузер будит SW событием `sync` (тег
// vanmark-queue) и повторяет его, пока прогон не завершится успешно. Логика дублирует sync.ts на
// vanilla (SW не импортирует TS-модули приложения); идемпотентность сервера страхует любые гонки с
// открытой вкладкой, а Web Locks не дают гнать досылку из SW и из вкладки одновременно.
const OFFLINE_DB = "vanmark-offline";
const Q_STORE = "queue";
const B_STORE = "blobs";
// Порог предохранителя: после стольких подряд необработанных ошибок приложения (HTTP 500) на ОДНОМ
// действии оно помечается конфликтом (SERVER_REJECTED), а прогон продолжается — чтобы одно застрявшее
// действие не блокировало очередь навсегда (инцидент 06.07). Держать в синхроне с SERVER_ERROR_LIMIT в
// src/lib/offline/sync.ts. Обрывы связи и прочие 5xx (502/503/504/501/505… — инфраструктура/деплой) к
// порогу не считаем.
const SERVER_ERROR_LIMIT = 5;

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB); // без версии — открыть существующую (её создало приложение)
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const idbAll = (db, store) => idbTx(db, store, "readonly", (s) => s.getAll());
const idbGetKey = (db, store, key) => idbTx(db, store, "readonly", (s) => s.get(key));
const idbDelKey = (db, store, key) => idbTx(db, store, "readwrite", (s) => s.delete(key));
const idbPutKey = (db, store, key, val) => idbTx(db, store, "readwrite", (s) => s.put(val, key));

// Отправка одного действия: JSON-мутация или multipart (фото/акт из blob). Возвращает Response
// (в т.ч. синтетический 422 при потерянном blob — чтобы пометилось конфликтом, как в send.ts).
async function sendQueuedAction(db, a) {
  const headers = { "Idempotency-Key": a.id, "X-Occurred-At": a.occurredAt };
  if (a.blobId) {
    const rec = await idbGetKey(db, B_STORE, a.blobId).catch(() => null);
    if (!rec) {
      return new Response(
        JSON.stringify({ error: { code: "BLOB_MISSING", message: "Фото не сохранилось на телефоне — снимите заново" } }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
    const form = new FormData();
    form.append("file", rec.blob, rec.name);
    if (a.blobMeta && a.blobMeta.kind === "DOCUMENT") form.append("kind", "DOCUMENT");
    return fetch(a.url, { method: "POST", body: form, headers });
  }
  return fetch(a.url, {
    method: a.method,
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: a.bodyJson === undefined ? undefined : JSON.stringify(a.bodyJson),
  });
}

// Прогон очереди FIFO. Нет сети / 5xx кроме 500 (инфраструктура, деплой) → throw (браузер повторит sync);
// 401/403 → стоп; HTTP 500 (необработанная ошибка приложения) → счётчик attempts, после порога —
// конфликт (SERVER_REJECTED) и идём дальше; доменная 4xx → конфликт. Двойник src/lib/offline/sync.ts.
async function replayQueue() {
  let db;
  try {
    db = await openOfflineDb();
  } catch (e) {
    return; // БД ещё не создана (приложение ни разу не открывали) — нечего досылать
  }
  const actions = (await idbAll(db, Q_STORE).catch(() => [])).sort(
    (a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let replayed = 0;
  for (const a of actions) {
    if (a.status === "conflict") continue;
    let res;
    try {
      res = await sendQueuedAction(db, a);
    } catch (e) {
      throw e; // нет сети — пробрасываем, браузер перезапустит sync позже
    }
    if (res.ok) {
      await idbDelKey(db, Q_STORE, a.id);
      if (a.blobId) await idbDelKey(db, B_STORE, a.blobId).catch(() => {});
      replayed++;
    } else if (res.status === 401 || res.status === 403) {
      break; // сессия истекла — стоп (после входа очередь досошлёт открытая вкладка)
    } else if (res.status === 500) {
      // HTTP 500 (необработанная ошибка приложения): считаем последовательные 500-отказы одного действия (см. sync.ts).
      const attempts = (a.attempts || 0) + 1;
      if (attempts >= SERVER_ERROR_LIMIT) {
        // Порог — изолируем застрявшее действие, прогон продолжаем (не throw), очередь досылает остальные.
        await idbPutKey(
          db,
          Q_STORE,
          a.id,
          Object.assign({}, a, {
            status: "conflict",
            attempts,
            lastError: { code: "SERVER_REJECTED", message: "Сервер не принимает действие — обратитесь к диспетчеру" },
          }),
        );
        continue;
      }
      await idbPutKey(db, Q_STORE, a.id, Object.assign({}, a, { attempts })); // сохраняем счётчик между sync
      throw new Error("server 500"); // ещё не порог — пусть браузер повторит sync
    } else if (res.status >= 500) {
      throw new Error("gateway " + res.status); // прочие 5xx (502/503/504/501/505…) — инфраструктура/деплой, к порогу не считаем; повтор sync
    } else {
      const body = await res.json().catch(() => null);
      const lastError = {
        code: (body && body.error && body.error.code) || "HTTP_" + res.status,
        message: (body && body.error && body.error.message) || "Ошибка",
      };
      await idbPutKey(db, Q_STORE, a.id, Object.assign({}, a, { status: "conflict", attempts: (a.attempts || 0) + 1, lastError }));
    }
  }
  if (replayed > 0) {
    const cs = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of cs) c.postMessage({ type: "queue-replayed" });
  }
}

// Координация с открытой вкладкой (processQueue тоже берёт этот лок): ifAvailable — не ждём, если
// вкладка уже досылает; серверная идемпотентность страхует, даже если оба прошли одновременно.
async function replayWithLock() {
  if (navigator.locks && navigator.locks.request) {
    await navigator.locks.request("vanmark-queue", { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      await replayQueue();
    });
  } else {
    await replayQueue();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "vanmark-queue") event.waitUntil(replayWithLock());
});
