"use client";
// Синхронизатор очереди: досылает накопленные офлайн-действия по порядку (FIFO).
// - сетевая/серверная ошибка (retryable) → прерываем прогон, повторим при следующем тике;
// - доменная ошибка 4xx → помечаем действие «конфликт» (диспетчер изменил задачу / переход уже
//   невозможен) — оно остаётся в очереди для показа водителю и НЕ блокирует остальные действия.
// Идемпотентность на сервере гарантирует, что уже применённое действие повтор не задвоит.
import { ApiError } from "@/lib/fetcher";
import { idbDelete, STORE_BLOBS } from "./db";
import { listQueue, dequeue, putQueued } from "./queue";
import { sendAction } from "./send";

let running = false;

/** Прогон очереди. Возвращает число успешно досланных действий (вызывающий решает про ревалидацию). */
export async function processQueue(): Promise<number> {
  if (running) return 0; // один прогон за раз (досылка строго последовательна)
  running = true;
  let sent = 0;
  try {
    const actions = await listQueue();
    for (const a of actions) {
      if (a.status === "conflict") continue; // конфликтные ждут разбора, не трогаем
      try {
        await sendAction(a);
        await dequeue(a.id);
        if (a.blobId) await idbDelete(STORE_BLOBS, a.blobId).catch(() => {}); // освобождаем фото после отправки
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.retryable) break; // нет сети/сервер лёг — стоп, повторим позже
        const lastError =
          e instanceof ApiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: "Ошибка" };
        await putQueued({ ...a, status: "conflict", attempts: a.attempts + 1, lastError });
      }
    }
  } finally {
    running = false;
  }
  return sent;
}
