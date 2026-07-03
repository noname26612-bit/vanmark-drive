"use client";
// Синхронизатор очереди: досылает накопленные офлайн-действия по порядку (FIFO).
// - сетевая/серверная ошибка (retryable) → прерываем прогон, повторим при следующем тике;
// - 401/403 (сессия истекла / права отозваны) → стоп + флаг authRequired; действие НЕ конфликт
//   (оно валидное, не хватает свежей сессии), после релогина досошлётся (O8);
// - доменная ошибка 4xx → помечаем действие «конфликт» (диспетчер изменил задачу / переход уже
//   невозможен / фото потеряно) — остаётся в очереди для разбора водителем, НЕ блокирует остальные.
// Идемпотентность на сервере гарантирует, что уже применённое действие повтор не задвоит.
import { ApiError } from "@/lib/fetcher";
import { idbDelete, STORE_BLOBS } from "./db";
import { listQueue, dequeue, putQueued } from "./queue";
import { sendAction } from "./send";
import { setAuthRequired } from "./auth-required";
import type { QueuedAction } from "./types";

/** Инъекция зависимостей — чтобы прогон очереди юнит-тестировался без IndexedDB/сети (как fetchWithCache). */
export type QueueDeps = {
  list: () => Promise<QueuedAction[]>;
  send: (a: QueuedAction) => Promise<void>;
  remove: (id: string) => Promise<void>;
  dropBlob: (blobId: string) => Promise<void>;
  markConflict: (a: QueuedAction, lastError: { code: string; message: string }) => Promise<void>;
  onAuthRequired: () => void; // 401/403 при досылке — сессия/права
  onAuthOk: () => void; // любое успешное действие снимает флаг сессии
};

/**
 * Один проход очереди с инъекцией зависимостей. Возвращает число успешно досланных действий.
 * Останавливается на первой retryable-ошибке (нет сети/5xx) и на 401/403 (сессия) — остаток уйдёт
 * на следующем тике / после релогина. Доменные 4xx помечает конфликтом и идёт дальше.
 */
export async function runQueueOnce(deps: QueueDeps): Promise<number> {
  const actions = await deps.list();
  let sent = 0;
  for (const a of actions) {
    if (a.status === "conflict") continue; // конфликтные ждут разбора, не трогаем
    try {
      await deps.send(a);
      await deps.remove(a.id);
      if (a.blobId) await deps.dropBlob(a.blobId).catch(() => {}); // освобождаем фото после отправки
      deps.onAuthOk(); // действие прошло → сессия жива, снимаем возможный флаг
      sent++;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        deps.onAuthRequired(); // сессия истекла / права — стоп, НЕ конфликт (действие валидное)
        break;
      }
      if (e instanceof ApiError && e.retryable) break; // нет сети/сервер лёг — стоп, повторим позже
      const lastError =
        e instanceof ApiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: "Ошибка" };
      await deps.markConflict(a, lastError);
    }
  }
  return sent;
}

let running = false;

const DEPS = {
  list: listQueue,
  send: sendAction,
  remove: dequeue,
  dropBlob: (blobId: string) => idbDelete(STORE_BLOBS, blobId),
  markConflict: (a: QueuedAction, lastError: { code: string; message: string }) =>
    putQueued({ ...a, status: "conflict", attempts: a.attempts + 1, lastError }),
  onAuthRequired: () => setAuthRequired(true),
  onAuthOk: () => setAuthRequired(false),
};

/**
 * Прогон очереди (боевые зависимости). Возвращает число досланных действий (вызывающий решает про
 * ревалидацию). O11: берём Web Lock "vanmark-queue" (ifAvailable) — чтобы не гнать досылку из вкладки
 * и из SW-Background-Sync одновременно; занят лок → пропускаем (SW уже досылает), идемпотентность
 * сервера всё равно страхует. Нет Web Locks API → прогон как раньше.
 */
export async function processQueue(): Promise<number> {
  if (running) return 0; // один прогон за раз в этой вкладке
  running = true;
  try {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      let sent = 0;
      await navigator.locks.request("vanmark-queue", { ifAvailable: true }, async (lock) => {
        if (!lock) return; // SW-replay держит лок — не мешаем
        sent = await runQueueOnce(DEPS);
      });
      return sent;
    }
    return await runQueueOnce(DEPS);
  } finally {
    running = false;
  }
}
