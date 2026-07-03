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
  return null;
}
