"use client";
import { useEffect } from "react";

// Регистрирует service worker (/sw.js) на всех страницах: web-push + офлайн-кэш оболочки (Cache API).
// В dev (localhost) кэш в SW отключён guard'ом — HMR не ломается; на проде кэшируются статика и
// оболочка ради холодного старта без сети. Без SW не работают пуш-подписки.
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  }, []);
  return null;
}
