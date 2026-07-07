"use client";
import { useEffect } from "react";
import { watchControllerChange } from "@/lib/offline/sw-update";

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
    // Инцидент 07.07: при деплое новый SW удаляет кэш старой сборки, а вкладка остаётся на старом
    // BUILD_ID → её чанки на сервере уже 404 → «This page couldn't load». Перезагружаем при смене
    // контроллера, чтобы подтянуть свежий HTML/чанки. См. watchControllerChange (там же — почему не
    // на первом визите и почему не на /login).
    return watchControllerChange(
      navigator.serviceWorker,
      () => window.location.reload(),
      () => window.location.pathname.startsWith("/login"),
    );
  }, []);
  return null;
}
