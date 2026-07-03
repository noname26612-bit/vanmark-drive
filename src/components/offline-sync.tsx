"use client";
// Монтируется один раз в layout водителя: запускает фоновый синхронизатор офлайн-очереди
// (досылка при возврате связи, на старте и периодически). Ничего не рендерит.
import { useEffect } from "react";
import { useOfflineSync } from "@/lib/offline/use-queue";

export function OfflineSync() {
  useOfflineSync();
  // Устойчивое хранилище (O8): без него браузер вправе выселить IndexedDB под нехваткой места —
  // и очередь неотправленных действий/фото пропадёт. У установленного TWA запрос обычно проходит без
  // диалога. Best-effort, один раз: если уже persisted — не трогаем.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
    void navigator.storage
      .persisted()
      .then((already) => (already ? undefined : navigator.storage.persist()))
      .catch(() => {});
  }, []);
  // Прогрев оболочки (O9): OfflineSync живёт в layout водителя — значит пользователь уже вошёл и /m
  // отдаёт настоящую оболочку, а не логин-редирект. Просим SW перекэшировать /m «чистым» ответом,
  // чтобы холодный старт без сети открывал приложение, а не логин-тупик.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready
      .then((reg) => reg.active?.postMessage({ type: "warm-shell" }))
      .catch(() => {});
  }, []);
  return null;
}
