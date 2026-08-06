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

// Потолки ожидания сети (инцидент «висит на логотипе», 31.07): TWA снимает сплэш только когда пришёл
// ответ на навигационный запрос. fetch без таймаута на «висящей» сети (сигнал есть, данные не идут —
// стройка, паркинг, залипший NAT) держал сплэш минутами при ГОТОВОМ кэше оболочки под рукой.
// NAV_TIMEOUT_MS покрывает и всплески TTFB сервера (замерено до 5–7 с).
const NAV_TIMEOUT_MS = 8000;
const STATIC_TIMEOUT_MS = 15000;

function fetchWithTimeout(req, ms) {
  const canTimeout = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal;
  return fetch(req, canTimeout ? { signal: AbortSignal.timeout(ms) } : undefined);
}

// Поиск ТОЛЬКО по app-кэшам (текущий + предыдущий): caches.match() без имени сканировал бы и сотню
// фото (лишние десятки мс на слабом телефоне). ignoreVary — Next шлёт Vary: RSC,Next-Router-…, и
// точное совпадение заголовков между сохранённым и живым запросом — случайность, а не гарантия;
// без ignoreVary фолбэк мог молча промахиваться при физически лежащей записи.
async function matchAppCaches(req) {
  const keys = (await caches.keys()).filter((k) => k.startsWith("vanmark-app-"));
  for (const k of keys) {
    const hit = await (await caches.open(k)).match(req, { ignoreVary: true });
    if (hit) return hit;
  }
  return undefined;
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
    event.respondWith(networkFirst(event, req, url));
    return;
  }
});

async function cacheFirst(req) {
  // Ищем в app-кэшах (текущий + предыдущий), а не только в текущем: при деплое старый клиент, ещё
  // живущий в памяти вкладки, может запросить хэш-чанк прошлой сборки — отдаём его из предыдущего
  // кэша, чтобы навигация не упала в 404 до перезагрузки (инцидент 07.07). Хэш в имени файла
  // гарантирует, что контент не перепутается между версиями. Вызывается только для /_next/static/
  // и /icons/ — эти пути не пересекаются с фото-кэшем (/api/attachments/).
  const hit = await matchAppCaches(req);
  if (hit) return hit;
  try {
    const res = await fetchWithTimeout(req, STATIC_TIMEOUT_MS);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(req, res.clone()).catch(() => {}); // переполнение квоты — не роняем ответ
    }
    return res;
  } catch (e) {
    // Параллельная навигация/прогрев могли доложить чанк, пока мы ждали сеть — последний шанс.
    const retry = await matchAppCaches(req);
    if (retry) return retry;
    throw e; // честный отказ: его поймает error boundary страницы, а не вечный белый экран
  }
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

async function networkFirst(event, req, url) {
  const cache = await caches.open(CACHE);
  const attempt = (async () => {
    // Без аборта: если ответим из кэша по таймауту, сеть пусть доедет и доложится в кэш фоном.
    const res = await fetch(req);
    // Навигационные запросы идут с redirect:"manual" → 307 корня "/" приходит как opaqueredirect
    // (status 0, res.url === "" — НЕ парсить new URL(res.url)!). Отдаём браузеру как есть — он сам
    // продолжит на /m. Раньше пустой res.url ронял new URL() и КАЖДЫЙ старт с "/" при живой сети
    // ложно уходил в catch-ветку и получал закэшированный HTML (хронический build-skew).
    if (res.type === "opaqueredirect" || res.type === "opaque") return res;
    if (isCacheableNav(res, url)) {
      cache.put(req, res.clone());
      trimNavigations(cache); // не ждём — фоновая обрезка
    }
    // Окно деплоя/рестарта: Caddy отдаёт 502/503, пока контейнер поднимается. Показывать голую
    // ошибку при полном кэше оболочки под рукой незачем — отдаём кэш.
    if (res.status >= 500) {
      const hit = await matchAppCaches(req);
      if (hit) return hit;
    }
    return res;
  })();

  const TIMEOUT = Symbol("timeout");
  const FAILED = Symbol("failed");
  const winner = await Promise.race([
    attempt.catch(() => FAILED),
    new Promise((r) => setTimeout(() => r(TIMEOUT), NAV_TIMEOUT_MS)),
  ]);

  if (winner === TIMEOUT) {
    // «Висящая» сеть: сплэш TWA снимается только по ответу — отдаём кэш сразу, сеть доложится фоном.
    const hit = await matchAppCaches(req);
    const home = hit ? undefined : await matchAppCaches(new Request(SHELL_URL));
    if (hit || home) {
      event.waitUntil(attempt.then(() => {}).catch(() => {}));
      // Для "/" — редирект на оболочку её собственным URL (см. FAILED-ветку ниже), не подмена HTML.
      if (!hit && url.pathname === "/") return Response.redirect(SHELL_URL, 302);
      return hit || home;
    }
    return attempt; // кэша нет (первый визит) — ждём сеть сколько нужно: медленно лучше, чем ошибка
  }
  if (winner === FAILED) {
    const hit = await matchAppCaches(req);
    if (hit) return hit;
    // Запасной экран — оболочка «Мои задачи». Холодный офлайн-старт с иконки — это "/" (start_url
    // TWA), а корень — всегда редирект и в кэш не попадает: браузер отправляем на оболочку её
    // СОБСТВЕННЫМ URL (подмена HTML под чужим path дала бы рассинхрон pathname при гидратации,
    // а неавторизованный увидел бы чужую оболочку вместо логина).
    const home = await matchAppCaches(new Request(SHELL_URL));
    if (home) return url.pathname === "/" ? Response.redirect(SHELL_URL, 302) : home;
    return attempt; // перебросит исходную сетевую ошибку
  }
  return winner;
}

// Прогрев JS-чанков из прогретого HTML (инцидент 31.07): раньше кэшировался только HTML, а его
// чанки — нет; офлайн-старт отдавал HTML, чьи <script> не находились ни в сети, ни в кэше → белый
// экран. Список чанков берём из самого HTML (другого источника у SW нет). Best-effort, до 80 URL.
const CHUNK_RE = /\/_next\/static\/[^"'\s\\]+/g;
async function warmChunks(cache, html) {
  const urls = [...new Set(html.match(CHUNK_RE) || [])].slice(0, 80);
  for (const u of urls) {
    if (await cache.match(u, { ignoreVary: true })) continue;
    try {
      const r = await fetchWithTimeout(u, STATIC_TIMEOUT_MS);
      if (r.ok) await cache.put(u, r);
    } catch (e) {
      /* best-effort: недокачанный чанк доложится при живой навигации */
    }
  }
}

// Перекэшировать оболочку /m «настоящим» ответом (не логин-редиректом). Вызывается при install и по
// сообщению warm-shell из приложения (после входа — тогда /m точно отдаёт оболочку, а не редирект).
// Таймаут обязателен: install ждёт warmShell, а затянутый install откладывает skipWaiting — и
// controllerchange-reload прилетал бы посреди работы водителя, а не на старте.
async function warmShell(cache) {
  try {
    const res = await fetchWithTimeout(SHELL_URL, NAV_TIMEOUT_MS);
    if (isCacheableNav(res, new URL(res.url))) {
      await cache.put(SHELL_URL, res.clone());
      await warmChunks(cache, await res.clone().text());
    }
  } catch (e) {
    /* нет сети при install — оболочка ляжет позже, из networkFirst или warm-shell */
  }
}

// Навигационные записи (HTML) — не статика/иконки. Держим не больше MAX_NAV_ENTRIES: при переполнении
// удаляем самые старые (порядок keys() ≈ порядок вставки — грубый FIFO, достаточно для масштаба).
// Оболочку /m не вытесняем никогда: это единственный запасной экран холодного старта, а кладётся она
// при install ПЕРВОЙ — без исключения FIFO выбрасывал бы именно её.
async function trimNavigations(cache) {
  const keys = await cache.keys();
  const nav = keys.filter((r) => {
    const p = new URL(r.url).pathname;
    return !p.startsWith("/_next/static/") && !p.startsWith("/icons/") && p !== SHELL_URL;
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
  let lastHtml = null;
  for (const u of urls.slice(0, MAX_NAV_ENTRIES)) {
    try {
      const res = await fetchWithTimeout(u, NAV_TIMEOUT_MS);
      if (isCacheableNav(res, new URL(res.url))) {
        await cache.put(u, res.clone());
        lastHtml = await res.clone().text();
      }
    } catch (e) {
      /* нет сети — пропускаем, прогреется в следующий раз */
    }
  }
  await trimNavigations(cache);
  // Чанки одной карточки покрывают остальные (общий бандл роута /m/[id]) — греем по последнему HTML.
  if (lastHtml) await warmChunks(cache, lastHtml);
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
// Возраст syncing-страховки (send.ts putDirect), после которого прямой fetch вкладки заведомо мёртв.
// Держать в синхроне с DIRECT_STALE_MS в src/lib/offline/send.ts.
const DIRECT_STALE_MS = 120000;

// Открытие offline-БД из SW. ВАЖНО: indexedDB.open(name) БЕЗ версии создаёт БД, если её нет — и
// раньше создавал ПУСТУЮ (без сторов): sync-событие, пришедшее до первого запуска приложения (или
// после очистки хранилища при уцелевшем sync-теге), «отравляло» БД навсегда — у приложения
// onupgradeneeded на той же версии уже не срабатывал, и все idb-операции молча падали (очередь не
// писалась, кэш не работал). Теперь схема создаётся здесь же, а у существующей БД недостающие сторы
// доращиваются версионным открытием. Схема — двойник src/lib/offline/db.ts, держать в синхроне.
const OFFLINE_STORES = ["responses", Q_STORE, B_STORE];
function rawOpenOfflineDb(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(OFFLINE_DB, version) : indexedDB.open(OFFLINE_DB);
    req.onupgradeneeded = () => {
      for (const s of OFFLINE_STORES) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      }
    };
    req.onblocked = () => reject(new Error("offline db blocked"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function openOfflineDb() {
  const db = await rawOpenOfflineDb();
  if (OFFLINE_STORES.every((s) => db.objectStoreNames.contains(s))) return db;
  const v = db.version + 1; // БД «отравлена» (создана без сторов) — доращиваем версионным открытием
  db.close();
  return rawOpenOfflineDb(v);
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

// Потолки ожидания сети при досылке (инцидент «мёртвая кнопка», 31.07): «висящий» fetch без таймаута
// держал Web Lock "vanmark-queue" навсегда — и SW-, и вкладочная досылка вставали до перезагрузки.
// Blob (фото/акт) щедрее вкладки: фон, UX-цены нет. Нет AbortSignal.timeout → без таймаута, как раньше.
function actionTimeoutSignal(a) {
  if (typeof AbortSignal === "undefined" || !("timeout" in AbortSignal)) return undefined;
  return AbortSignal.timeout(a.blobId ? 120000 : 20000);
}

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
    return fetch(a.url, { method: "POST", body: form, headers, signal: actionTimeoutSignal(a) });
  }
  return fetch(a.url, {
    method: a.method,
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: a.bodyJson === undefined ? undefined : JSON.stringify(a.bodyJson),
    signal: actionTimeoutSignal(a),
  });
}

// Прогон очереди FIFO. Нет сети / 5xx кроме 500 (инфраструктура, деплой) → throw (браузер повторит sync);
// 401 (сессия) → стоп; 403 (доменный отказ в правах, сессия жива) → конфликт и дальше — как доменная
// 4xx (раньше 403 навсегда останавливал досылку); HTTP 500 (необработанная ошибка приложения) →
// счётчик attempts, после порога — конфликт (SERVER_REJECTED) и идём дальше; доменная 4xx → конфликт.
// Двойник src/lib/offline/sync.ts — держать логику в синхроне.
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
  let changed = false; // любая запись в IndexedDB (conflict/attempts) — вкладка должна перечитать очередь
  try {
    for (const a of actions) {
      if (a.status === "conflict") continue;
      if (a.status === "syncing") {
        // Страховка прямой отправки вкладки (send.ts putDirect). Свежая — fetch вкладки ещё в полёте:
        // прерываем sync ошибкой, браузер повторит позже (к тому времени запись либо снята, либо
        // осиротела). Старая — страница умерла посреди отправки: возвращаем в pending и досылаем
        // (Idempotency-Key обезвредит повтор, если fetch вкладки всё же дошёл).
        const started = a.directAt ? Date.parse(a.directAt) : NaN;
        if (Number.isFinite(started) && Date.now() - started < DIRECT_STALE_MS) {
          throw new Error("direct send in flight");
        }
        await idbPutKey(db, Q_STORE, a.id, Object.assign({}, a, { status: "pending", directAt: undefined }));
        changed = true;
      }
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
      } else if (res.status === 401) {
        break; // сессия истекла — стоп (после входа очередь досошлёт открытая вкладка)
        // 403 сюда НЕ попадает: доменный отказ в правах идёт ниже общей веткой 4xx → конфликт и дальше.
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
          changed = true;
          reportRejected(a, attempts); // fire-and-forget, наблюдаемость
          continue;
        }
        await idbPutKey(db, Q_STORE, a.id, Object.assign({}, a, { attempts })); // сохраняем счётчик между sync
        changed = true;
        throw new Error("server 500"); // ещё не порог — пусть браузер повторит sync (notifyClients — в finally)
      } else if (res.status >= 500) {
        throw new Error("gateway " + res.status); // прочие 5xx (502/503/504/501/505…) — инфраструктура/деплой, к порогу не считаем; повтор sync
      } else {
        const body = await res.json().catch(() => null);
        const lastError = {
          code: (body && body.error && body.error.code) || "HTTP_" + res.status,
          message: (body && body.error && body.error.message) || "Ошибка",
        };
        await idbPutKey(db, Q_STORE, a.id, Object.assign({}, a, { status: "conflict", attempts: (a.attempts || 0) + 1, lastError }));
        changed = true;
      }
    }
  } finally {
    await notifyClients(replayed, changed); // и при обрыве прогона (throw) вкладка узнаёт об изменениях
  }
}

// Срабатывание предохранителя в фоне — инцидентный сигнал: best-effort репорт на сервер
// (наблюдаемость, 31.07), чтобы разбирать без телефона водителя. Ошибки глушим.
function reportRejected(a, attempts) {
  try {
    const canTimeout = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal;
    fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg: "SERVER_REJECTED: " + a.kind + " " + a.url + " after " + attempts + " attempts",
        context: "sw-replay",
      }),
      signal: canTimeout ? AbortSignal.timeout(5000) : undefined,
    }).catch(() => {});
  } catch (e) {
    /* диагностика не роняет досылку */
  }
}

// Сообщить вкладкам о результате прогона. Шлём и при changed без replayed (все действия ушли в
// conflict): раньше вкладка не узнавала о конфликте, продолжала рисовать оптимистичный статус
// поверх фактически «застрявшего» действия, и водитель считал задачу завершённой.
async function notifyClients(replayed, changed) {
  if (!replayed && !changed) return;
  try {
    const cs = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of cs) c.postMessage({ type: "queue-replayed" });
  } catch (e) {
    /* нет клиентов — не страшно, вкладка перечитает очередь при открытии */
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
