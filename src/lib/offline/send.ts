"use client";
// Отправка действия водителя: сразу (онлайн) или в очередь (офлайн/нет сети). Один ключ
// Idempotency-Key на действие — сервер применит его ровно один раз даже при повторной досылке.
import { apiSend, apiUpload, ApiError } from "@/lib/fetcher";
import { idbGet, idbPut, STORE_BLOBS } from "./db";
import { putQueued } from "./queue";
import { newActionId } from "./id";
import type { QueuedAction, QueuedActionKind } from "./types";

type BlobRecord = { blob: Blob; name: string; type: string };

// Монотонный порядковый номер постановки (O8): голый Date.now() при двух действиях в одну
// миллисекунду давал равный seq, и FIFO-порядок досылки становился неопределённым. Гарантируем строгий
// рост в пределах сессии; между сессиями монотонность продолжает время (Date.now всегда больше).
let lastSeq = 0;
export function nextSeq(): number {
  lastSeq = Math.max(Date.now(), lastSeq + 1);
  return lastSeq;
}

/** Низкоуровневая отправка одного действия с заголовками идемпотентности и времени. */
export async function sendAction(a: QueuedAction): Promise<void> {
  const headers = { "Idempotency-Key": a.id, "X-Occurred-At": a.occurredAt };
  if (a.blobId) {
    // Фото/документ, снятые офлайн (Коммит 5): восстанавливаем FormData из сохранённого blob.
    const rec = await idbGet<BlobRecord>(STORE_BLOBS, a.blobId);
    // blob пропал (эвикция IndexedDB) — раньше тихо считали успехом и теряли фото. Теперь это доменная
    // ошибка: действие уйдёт в «конфликт» с человеческой причиной, водитель снимет заново (O8).
    if (!rec) throw new ApiError("Фото не сохранилось на телефоне — снимите заново", 422, "BLOB_MISSING");
    const form = new FormData();
    form.append("file", rec.blob, rec.name);
    if (a.blobMeta?.kind === "DOCUMENT") form.append("kind", "DOCUMENT");
    await apiUpload(a.url, form, headers);
    return;
  }
  await apiSend(a.url, a.method, a.bodyJson, headers);
}

export type EnqueueParams = {
  kind: QueuedActionKind;
  method: "POST" | "PATCH" | "DELETE";
  url: string;
  taskId: string | null;
  bodyJson?: unknown;
  blobId?: string;
  blobMeta?: QueuedAction["blobMeta"];
};

/**
 * Отправить действие сразу (онлайн) или поставить в очередь (офлайн / нет связи / сервер лёг).
 * Доменные ошибки (4xx) пробрасываются — вызывающий откатит оптимистичный UI и покажет причину.
 * Возвращает { queued: true }, если действие ушло в очередь (UI покажет «ждёт отправки»).
 */
export async function enqueueOrSend(params: EnqueueParams): Promise<{ queued: boolean }> {
  const now = new Date().toISOString();
  const action: QueuedAction = {
    id: newActionId(),
    seq: nextSeq(),
    occurredAt: now,
    createdAt: now,
    status: "pending",
    attempts: 0,
    ...params,
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await putQueued(action);
    return { queued: true };
  }
  try {
    await sendAction(action);
    return { queued: false };
  } catch (e) {
    if (e instanceof ApiError && e.retryable) {
      await putQueued(action); // нет сети / сервер лёг — в очередь, досошлём позже
      return { queued: true };
    }
    throw e; // доменная ошибка — наверх (откат оптимистики, показ причины)
  }
}

/**
 * Фото/документ: отправить сразу (онлайн) или сохранить blob в IndexedDB и поставить в очередь
 * (офлайн / нет сети). При досылке sendAction восстановит FormData из blob; после успеха sync.ts
 * удалит blob. Доменные ошибки (например, неверный mime) пробрасываются.
 */
export async function enqueuePhoto(params: {
  url: string;
  taskId: string;
  blob: Blob;
  fileName: string;
  kind: "PHOTO" | "DOCUMENT";
}): Promise<{ queued: boolean }> {
  const occurredAt = new Date().toISOString();
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const form = new FormData();
      form.append("file", params.blob, params.fileName);
      if (params.kind === "DOCUMENT") form.append("kind", "DOCUMENT");
      await apiUpload(params.url, form, { "Idempotency-Key": newActionId(), "X-Occurred-At": occurredAt });
      return { queued: false };
    } catch (e) {
      if (!(e instanceof ApiError && e.retryable)) throw e; // доменная ошибка — наверх
      // нет сети / сервер лёг — уходим в офлайн-ветку (в очередь)
    }
  }
  const blobId = newActionId();
  await idbPut(STORE_BLOBS, blobId, { blob: params.blob, name: params.fileName, type: params.blob.type });
  const action: QueuedAction = {
    id: newActionId(),
    seq: nextSeq(),
    kind: "attachment",
    method: "POST",
    url: params.url,
    occurredAt,
    taskId: params.taskId,
    blobId,
    blobMeta: { name: params.fileName, type: params.blob.type, kind: params.kind },
    status: "pending",
    attempts: 0,
    createdAt: occurredAt,
  };
  await putQueued(action);
  return { queued: true };
}
