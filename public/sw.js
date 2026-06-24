// Service worker водителя: web-push (этап 5) + офлайн-кэш оболочки приложения (офлайн-режим).
// Рукописный, без Serwist: Serwist на Next 16 требует webpack-сборки и смены tsconfig на webworker
// (ломает типы React-проекта) — для нашего сценария избыточно. Здесь — лёгкий рантайм-кэш через
// Cache API: статические чанки Next кэшируются cache-first (они хэшированы → безопасно), навигация —
// network-first с откатом в кэш, чтобы при холодном старте без сети приложение всё равно открылось.
// Данные (список/карточка) офлайн отдаёт слой приложения (IndexedDB + cachedFetcher), не SW.
// ВНИМАНИЕ: это рантайм service worker (область self/clients), а не модуль приложения.

const CACHE = "vanmark-v1";
const PRECACHE = ["/m", "/icons/icon-192.png", "/icons/icon-512.png"];

// В dev (localhost) кэш оболочки ОТКЛЮЧЁН: иначе cache-first отдавал бы устаревшие чанки и ломал HMR.
// На проде (боевой домен) кэш включён — ради холодного старта без сети.
const CACHE_ENABLED =
  self.location.hostname !== "localhost" && self.location.hostname !== "127.0.0.1";

self.addEventListener("install", (event) => {
  if (!CACHE_ENABLED) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {})) // best-effort: один недоступный URL не валит установку
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Чистим кэши прошлых версий (после деплоя имя CACHE меняем — старые ассеты удаляются).
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("vanmark-") && k !== CACHE).map((k) => caches.delete(k)),
      );
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
  if (url.pathname.startsWith("/api/")) return; // данные кэширует приложение (IndexedDB), не SW

  // Хэшированная статика Next и иконки — cache-first (контент иммутабелен по имени).
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Навигация (открытие страниц) — network-first с откатом в кэш (холодный старт без сети).
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    const home = await cache.match("/m"); // запасной экран — список «Мои задачи»
    if (home) return home;
    throw e;
  }
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
