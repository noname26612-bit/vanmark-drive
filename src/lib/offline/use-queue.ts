"use client";
// React-хуки офлайн-очереди.
//  - usePendingActions: реактивный список действий в очереди (опц. по задаче) — для бейджей/счётчика.
//  - useOfflineSync: фоновый синхронизатор (монтируется один раз в layout водителя) — досылает очередь
//    при возврате связи, на старте и периодически; после успешной досылки обновляет данные SWR.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import { listQueue, onQueueChanged, emitQueueChanged } from "./queue";
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
      // Ошибку прогона не глотаем молча (инцидент 31.07: сломанная IndexedDB не оставляла ни одного
      // следа) — хотя бы console.error, его подхватит client-log (наблюдаемость, PR-4).
      const sent = await processQueue().catch((e: unknown) => {
        console.error("offline queue tick failed:", e);
        return 0;
      });
      if (sent > 0 && alive) void mutate(() => true); // после досылки обновляем все ключи SWR
    };
    void tick();
    const onOnline = () => void tick();
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => void tick(), 15_000);
    // Новое действие в очереди при живой сети должно уехать сразу, а не ждать 15-секундный тик:
    // с гейтом «непустая очередь → в хвост» (send.ts) даже онлайн-действия идут через очередь.
    // Дебаунс гасит каскад событий одного прогона; повторный вход дополнительно гасится флагом
    // running в processQueue. Прогон по пустой очереди дёшев (один запрос к IndexedDB).
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const offQueueChanged = onQueueChanged(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void tick(), 500);
    });
    // Background Sync досылает очередь из SW при свёрнутом приложении (O11). Вернувшись на экран,
    // вкладка узнаёт об этом сообщением queue-replayed: SW менял IndexedDB вне этой вкладки, поэтому
    // сами перечитываем очередь (бейджи) и обновляем данные SWR.
    const onSwMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === "queue-replayed" && alive) {
        emitQueueChanged();
        void mutate(() => true);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
      clearTimeout(debounce);
      offQueueChanged();
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    };
  }, [mutate]);
}
