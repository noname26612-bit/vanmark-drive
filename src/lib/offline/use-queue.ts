"use client";
// React-хуки офлайн-очереди.
//  - usePendingActions: реактивный список действий в очереди (опц. по задаче) — для бейджей/счётчика.
//  - useOfflineSync: фоновый синхронизатор (монтируется один раз в layout водителя) — досылает очередь
//    при возврате связи, на старте и периодически; после успешной досылки обновляет данные SWR.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import { listQueue, onQueueChanged } from "./queue";
import { processQueue } from "./sync";
import { getAuthRequired, subscribeAuthRequired } from "./auth-required";
import type { QueuedAction } from "./types";

/** Реактивный флаг «сессия истекла при досылке» (O8) — для баннера «войдите заново». SSR-снимок = false. */
export function useAuthRequired(): boolean {
  return useSyncExternalStore(subscribeAuthRequired, getAuthRequired, () => false);
}

export function usePendingActions(taskId?: string): QueuedAction[] {
  const [actions, setActions] = useState<QueuedAction[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listQueue().then((all) => {
        if (alive) setActions(taskId ? all.filter((a) => a.taskId === taskId) : all);
      });
    void refresh();
    const off = onQueueChanged(() => void refresh());
    return () => {
      alive = false;
      off();
    };
  }, [taskId]);
  return actions;
}

export function useOfflineSync(): void {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const sent = await processQueue().catch(() => 0);
      if (sent > 0 && alive) void mutate(() => true); // после досылки обновляем все ключи SWR
    };
    void tick();
    const onOnline = () => void tick();
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => void tick(), 15_000);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [mutate]);
}
