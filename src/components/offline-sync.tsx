"use client";
// Монтируется один раз в layout водителя: запускает фоновый синхронизатор офлайн-очереди
// (досылка при возврате связи, на старте и периодически). Ничего не рендерит.
import { useOfflineSync } from "@/lib/offline/use-queue";

export function OfflineSync() {
  useOfflineSync();
  return null;
}
