"use client";
// Отправка действия водителя: сразу (онлайн) или в очередь (офлайн/нет сети). Один ключ
// Idempotency-Key на действие — сервер применит его ровно один раз даже при повторной досылке.
//
// Outbox-страховка (жалобы Писарева, 07.08): прямой fetch живёт до 15–90 с (таймауты fetcher.ts),
// и всё это время действие существовало ТОЛЬКО в памяти страницы. Android убивает свёрнутую TWA
// незаметно — так 03.08 бесследно пропало закрытие смены (в логах Caddy нет POST, в очереди пусто),
// а фото актов гибли до первого байта. Теперь перед прямой отправкой действие (и blob) пишется в
// очередь со статусом "syncing": смерть страницы оставляет запись, reclaim (sync.ts/sw.js) вернёт
// её в pending и дошлёт. Свежий "syncing" прогоны не трогают — двойной отправки нет; гонку досылки
// с прямым fetch дополнительно страхует серверный Idempotency-Key.
import { apiSend, apiUpload, ApiError } from "@/lib/fetcher";
import { idbGet, idbPut, idbDelete, STORE_BLOBS, STORE_QUEUE } from "./db";
import { listQueue, putQueued, registerBackgroundSync } from "./queue";
import { newActionId } from "./id";
import type { QueuedAction, QueuedActionKind } from "./types";

/** Возраст syncing-записи, после которого прямой fetch заведомо мёртв (больше UPLOAD_TIMEOUT_MS). */
export const DIRECT_STALE_MS = 120_000;

/**
 * Тихая страховочная запись прямой отправки: без события очереди (UI не мигает бейджем «ждёт» на
 * время обычного fetch). Background Sync регистрируем: если страница умрёт в полёте, браузер позже
 * разбудит SW, reclaim переведёт запись в pending и дошлёт. Отказ IndexedDB не роняет отправку —
 * действие просто идёт без страховки, как раньше.
 */
async function putDirect(action: QueuedAction): Promise<void> {
  try {
    await idbPut(STORE_QUEUE, action.id, action);
    void registerBackgroundSync();
  } catch {
    /* нет IndexedDB (private mode и т.п.) — деградация к прежнему поведению */
  }
}

/** Тихое снятие страховки после исхода прямой отправки. Отказ не критичен: осиротевшую запись
 *  подберёт reclaim, а повтор досылки обезврежен Idempotency-Key. */
async function removeDirect(id: string): Promise<void> {
  await idbDelete(STORE_QUEUE, id).catch(() => {});
}

type BlobRecord = { blob: Blob; name: string; type: string };

/**
 * В очереди есть неотправленные действия? Тогда новое действие обязано встать в ХВОСТ, а не лететь
 * онлайн напрямую: прямая отправка обгоняла FIFO (застрявший «В работу» ещё в очереди, а «Завершить»
 * уже на сервере при статусе ASSIGNED → 409 FORBIDDEN_TRANSITION). Конфликтные записи хвостом не
 * считаются — они ждут разбора и не будут досланы.
 */
async function queueBusy(): Promise<boolean> {
  return (await listQueue()).some((a) => a.status !== "conflict");
}

/**
 * Стоит ли класть онлайн-неудачу в очередь. HTTP 500 — детерминированная ошибка приложения: тихая
 * постановка в очередь рисовала оптимистичный DONE, который через ~75 с откатывался (SERVER_REJECTED)
 * без объяснений. Решение Артёма 31.07: онлайн-500 показываем сразу, в очередь НЕ кладём. Обрыв
 * сети/таймаут (status 0) и инфраструктурные 5xx (502/503/504 — деплой, прокси) — в очередь.
 */
function shouldQueueOnlineFailure(e: unknown): boolean {
  return e instanceof ApiError && e.retryable && e.status !== 500;
}

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

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if (offline || (await queueBusy())) {
    await putQueued(action);
    return { queued: true };
  }
  await putDirect({ ...action, status: "syncing", directAt: now }); // страховка на время прямого fetch
  try {
    await sendAction(action);
  } catch (e) {
    if (shouldQueueOnlineFailure(e)) {
      await putQueued(action); // нет сети / сервер лёг — тот же id: страховка становится pending-записью
      return { queued: true };
    }
    await removeDirect(action.id);
    throw e; // доменная ошибка или онлайн-500 — наверх (откат оптимистики, показ причины)
  }
  await removeDirect(action.id);
  return { queued: false };
}

/**
 * Фото/документ: blob СНАЧАЛА сохраняется в IndexedDB (страховка — кадр переживает смерть страницы),
 * затем действие либо уходит сразу (онлайн, sendAction восстановит FormData из blob), либо встаёт в
 * очередь (офлайн / нет сети / хвост). После успеха blob и страховка удаляются. Доменные ошибки
 * (например, неверный mime) пробрасываются — blob при этом тоже освобождаем.
 */
export async function enqueuePhoto(params: {
  url: string;
  taskId: string;
  blob: Blob;
  fileName: string;
  kind: "PHOTO" | "DOCUMENT";
}): Promise<{ queued: boolean }> {
  const occurredAt = new Date().toISOString();
  const blobId = newActionId();
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
  let blobSaved = true;
  try {
    await idbPut(STORE_BLOBS, blobId, { blob: params.blob, name: params.fileName, type: params.blob.type });
  } catch {
    blobSaved = false; // нет IndexedDB — работаем без страховки, из памяти (как раньше)
  }

  const online = typeof navigator === "undefined" || navigator.onLine;
  if (!blobSaved) {
    // Деградация без IndexedDB: очередь всё равно недоступна — только прямая попытка.
    const form = new FormData();
    form.append("file", params.blob, params.fileName);
    if (params.kind === "DOCUMENT") form.append("kind", "DOCUMENT");
    await apiUpload(params.url, form, { "Idempotency-Key": action.id, "X-Occurred-At": occurredAt });
    return { queued: false };
  }
  if (!online || (await queueBusy())) {
    await putQueued(action);
    return { queued: true };
  }
  await putDirect({ ...action, status: "syncing", directAt: occurredAt }); // страховка на время загрузки
  try {
    await sendAction(action); // FormData соберётся из сохранённого blob
  } catch (e) {
    if (shouldQueueOnlineFailure(e)) {
      await putQueued(action); // обрыв/таймаут/шлюз — тот же id: страховка становится pending-записью
      return { queued: true };
    }
    await removeDirect(action.id);
    await idbDelete(STORE_BLOBS, blobId).catch(() => {});
    throw e; // доменная ошибка или онлайн-500 — наверх
  }
  await removeDirect(action.id);
  await idbDelete(STORE_BLOBS, blobId).catch(() => {});
  return { queued: false };
}
