"use client";
// Очередь исходящих действий водителя (IndexedDB store "queue"). Действия, выполненные без сети
// (или не дошедшие из-за обрыва), копятся здесь и досылаются синхронизатором (sync.ts) при возврате
// связи. Порядок — FIFO по seq. Изменения очереди транслируются событием, чтобы UI (бейджи
// «ждёт отправки», счётчик) обновлялся реактивно.
import { idbGetAll, idbPut, idbDelete, STORE_QUEUE } from "./db";
import type { QueuedAction } from "./types";

const CHANGED_EVENT = "vanmark-offline-queue-changed";

export function emitQueueChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onQueueChanged(cb: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, cb);
  return () => window.removeEventListener(CHANGED_EVENT, cb);
}

/** Все действия очереди в порядке постановки (FIFO). */
export async function listQueue(): Promise<QueuedAction[]> {
  const all = await idbGetAll<QueuedAction>(STORE_QUEUE).catch(() => [] as QueuedAction[]);
  return all.sort((a, b) => a.seq - b.seq);
}

export async function putQueued(action: QueuedAction): Promise<void> {
  await idbPut(STORE_QUEUE, action.id, action);
  emitQueueChanged();
}

export async function dequeue(id: string): Promise<void> {
  await idbDelete(STORE_QUEUE, id);
  emitQueueChanged();
}
