"use client";
import { useEffect } from "react";

// Регистрирует service worker (/sw.js) на всех страницах: web-push + офлайн-кэш оболочки (Cache API).
// В dev (localhost) кэш в SW отключён guard'ом — HMR не ломается; на проде кэшируются статика и
// оболочка ради холодного старта без сети. Без SW не работают пуш-подписки.
// O9: для e2e с реальным SW на localhost сборка с NEXT_PUBLIC_SW_CACHE=on регистрирует /sw.js?cache=on —
// флаг в URL включает кэш внутри sw.js (иначе на localhost он выключен). На проде переменной нет → /sw.js.
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const url = process.env.NEXT_PUBLIC_SW_CACHE === "on" ? "/sw.js?cache=on" : "/sw.js";
    navigator.serviceWorker.register(url, { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
