// Тихий автоповтор мутаций при плохой сети (ui-guidelines: «не отправлено, повторяю…»).
// Сетевые сбои и 5xx ретраим с нарастающей паузой; доменные ошибки (4xx) — НЕ ретраим, бросаем,
// чтобы UI откатил оптимистичный статус и показал причину (например, недопустимый переход).
import { ApiError } from "./fetcher";

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function sendWithRetry(
  send: () => Promise<unknown>,
  opts: { onRetry?: (attempt: number) => void; signal?: AbortSignal; maxDelayMs?: number } = {},
): Promise<void> {
  const maxDelay = opts.maxDelayMs ?? 8000;
  for (let attempt = 0; ; attempt++) {
    try {
      await send();
      return;
    } catch (e) {
      // Доменная ошибка (неверный переход, нет прав, 404) — повтор не поможет.
      if (e instanceof ApiError && !e.retryable) throw e;
      if (opts.signal?.aborted) throw e;
      opts.onRetry?.(attempt + 1);
      const wait = Math.min(maxDelay, 1000 * 2 ** attempt);
      await delay(wait, opts.signal);
    }
  }
}
