"use client";
// Статус сети для UI. navigator.onLine не идеален (может врать про «онлайн» при мёртвом Wi-Fi),
// но достаточен для баннера «офлайн — показываю сохранённое»; реальную доставку проверяет сам fetch
// (ApiError status 0 → fallback в кэш / постановка в очередь). useSyncExternalStore — идиоматичная
// подписка на внешний источник: SSR-снимок = online, на клиенте — реальный navigator.onLine.
import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
