"use client";
// Синхронизатор очереди: досылает накопленные офлайн-действия по порядку (FIFO).
// - нет сети (status 0) или любой 5xx, кроме 500 (инфраструктура/прокси: Caddy отдаёт 502/503/504 при
//   рестарте бэкенда во время деплоя, редкие 501/505/510/511) → прерываем прогон, повторим при следующем
//   тике; счётчик отказов НЕ наращиваем;
// - приложение ответило HTTP 500 (необработанная ошибка) → возможно, действие «ядовитое» (детерминированный
//   отказ, как в инциденте 06.07). Наращиваем attempts и отходим; после SERVER_ERROR_LIMIT подряд — помечаем
//   действие «конфликт» (SERVER_REJECTED) и ПРОДОЛЖАЕМ прогон, чтобы одно застрявшее действие не блокировало
//   очередь навсегда. К порогу считаем только 500, не обрывы связи и не деплой — иначе долгий офлайн или
//   рестарт бэкенда ложно увели бы всю очередь в конфликт;
// - 401/403 (сессия истекла / права отозваны) → стоп + флаг authRequired; действие НЕ конфликт
//   (оно валидное, не хватает свежей сессии), после релогина досошлётся (O8);
// - доменная ошибка 4xx → помечаем действие «конфликт» (диспетчер изменил задачу / переход уже
//   невозможен / фото потеряно) — остаётся в очереди для разбора водителем, НЕ блокирует остальные.
// Идемпотентность на сервере гарантирует, что уже применённое действие повтор не задвоит.
// Vanilla-двойник для Background Sync — public/sw.js (replayQueue); держать логику в синхроне.
import { ApiError } from "@/lib/fetcher";
import { idbDelete, STORE_BLOBS } from "./db";
import { listQueue, dequeue, putQueued } from "./queue";
import { sendAction } from "./send";
import { setAuthRequired } from "./auth-required";
import type { QueuedAction } from "./types";

/**
 * Порог предохранителя: после стольких подряд необработанных ошибок приложения (HTTP 500) по ОДНОМУ
 * действию помечаем его конфликтом (SERVER_REJECTED) и продолжаем прогон — чтобы одно застрявшее действие
 * не блокировало очередь навсегда (инцидент 06.07). Значение согласовано с Артёмом (5 попыток ≈ 1–2 мин
 * при тике раз в 15 с). Держать в синхроне с SERVER_ERROR_LIMIT в public/sw.js.
 */
export const SERVER_ERROR_LIMIT = 5;

/**
 * «Ядовитое» действие проявляется как необработанная ошибка приложения — HTTP 500 (доменные ошибки идут
 * как 4xx, инфраструктура/прокси — как 502/503/504/501/505…). Только 500 считаем к порогу. Нет сети
 * (status 0) и прочие 5xx — временный сбой (деплой, рестарт бэкенда): их к порогу НЕ считаем, иначе
 * долгий офлайн или деплой ложно увёл бы всю очередь в конфликт.
 */
function isAppServerError(status: number): boolean {
  return status === 500;
}

/** Инъекция зависимостей — чтобы прогон очереди юнит-тестировался без IndexedDB/сети (как fetchWithCache). */
export type QueueDeps = {
  list: () => Promise<QueuedAction[]>;
  send: (a: QueuedAction) => Promise<void>;
  remove: (id: string) => Promise<void>;
  dropBlob: (blobId: string) => Promise<void>;
  markConflict: (a: QueuedAction, lastError: { code: string; message: string }, attempts: number) => Promise<void>;
  bumpAttempts: (a: QueuedAction, attempts: number) => Promise<void>; // сохранить счётчик отказов между тиками
  onAuthRequired: () => void; // 401/403 при досылке — сессия/права
  onAuthOk: () => void; // любое успешное действие снимает флаг сессии
};

/**
 * Один проход очереди с инъекцией зависимостей. Возвращает число успешно досланных действий.
 * - нет сети / 5xx кроме 500 (инфраструктура, деплой) → стоп, остаток уйдёт на следующем тике (счётчик не растёт);
 * - 401/403 (сессия) → стоп + флаг authRequired;
 * - HTTP 500 (необработанная ошибка приложения): наращиваем attempts и стоп; после SERVER_ERROR_LIMIT
 *   подряд — помечаем конфликтом (SERVER_REJECTED) и идём дальше (предохранитель от вечной блокировки);
 * - доменная 4xx → конфликт и идём дальше.
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
      if (e instanceof ApiError && e.retryable) {
        // Нет сети (status 0) или любой 5xx, кроме 500 (инфраструктура/прокси при деплое) — временный
        // сбой, не вина действия: отходим и повторим весь прогон на следующем тике, счётчик НЕ трогаем.
        if (!isAppServerError(e.status)) break;
        // HTTP 500 (необработанная ошибка) — возможно, действие «ядовитое» (детерминированный отказ,
        // инцидент 06.07). Считаем последовательные 500-отказы одного действия. (?? 0 — на случай
        // legacy-записи без поля attempts, иначе NaN сломал бы порог; так же страхует public/sw.js.)
        const attempts = (a.attempts ?? 0) + 1;
        if (attempts >= SERVER_ERROR_LIMIT) {
          // Порог достигнут — изолируем застрявшее действие, но прогон ПРОДОЛЖАЕМ (не break),
          // чтобы остальные действия очереди досылались.
          await deps.markConflict(
            a,
            { code: "SERVER_REJECTED", message: "Сервер не принимает действие — обратитесь к диспетчеру" },
            attempts,
          );
          continue;
        }
        await deps.bumpAttempts(a, attempts); // сохраняем счётчик, чтобы порог копился между тиками
        break; // ещё не порог — отходим (сохраняем FIFO и не долбим сервер), повторим на следующем тике
      }
      const lastError =
        e instanceof ApiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: "Ошибка" };
      await deps.markConflict(a, lastError, (a.attempts ?? 0) + 1);
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
  markConflict: (a: QueuedAction, lastError: { code: string; message: string }, attempts: number) =>
    putQueued({ ...a, status: "conflict", attempts, lastError }),
  bumpAttempts: (a: QueuedAction, attempts: number) => putQueued({ ...a, attempts }),
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
