"use client";
// Очередь исходящих действий водителя (IndexedDB store "queue"). Действия, выполненные без сети
// (или не дошедшие из-за обрыва), копятся здесь и досылаются синхронизатором (sync.ts) при возврате
// связи. Порядок — FIFO по seq. Изменения очереди транслируются событием, чтобы UI (бейджи
// «ждёт отправки», счётчик) обновлялся реактивно.
import { idbGetAll, idbPut, idbDelete, STORE_QUEUE, STORE_BLOBS } from "./db";
import type { QueuedAction } from "./types";

const CHANGED_EVENT = "vanmark-offline-queue-changed";

export function emitQueueChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onQueueChanged(cb: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, cb);
  return () => window.removeEventListener(CHANGED_EVENT, cb);
}

/** Все действия очереди в порядке постановки (FIFO). Тай-брейк по id (O8): при равном seq у легаси-
 *  записей (голый Date.now() до монотонного nextSeq) порядок иначе был бы неопределённым. */
export async function listQueue(): Promise<QueuedAction[]> {
  const all = await idbGetAll<QueuedAction>(STORE_QUEUE).catch(() => [] as QueuedAction[]);
  return all.sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function putQueued(action: QueuedAction): Promise<void> {
  await idbPut(STORE_QUEUE, action.id, action);
  emitQueueChanged();
}

export async function dequeue(id: string): Promise<void> {
  await idbDelete(STORE_QUEUE, id);
  emitQueueChanged();
}

/**
 * Убрать действие из очереди по решению водителя (кнопка «Убрать» в разборе конфликтов, O8).
 * Вместе с самим действием освобождаем связанный blob фото (иначе он висел бы в IndexedDB вечно).
 */
export async function discardAction(id: string): Promise<void> {
  const all = await idbGetAll<QueuedAction>(STORE_QUEUE).catch(() => [] as QueuedAction[]);
  const action = all.find((a) => a.id === id);
  await idbDelete(STORE_QUEUE, id);
  if (action?.blobId) await idbDelete(STORE_BLOBS, action.blobId).catch(() => {});
  emitQueueChanged();
}
