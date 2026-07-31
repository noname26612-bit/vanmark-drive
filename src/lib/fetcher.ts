// Ошибка API с кодом и HTTP-статусом — чтобы клиент мог отличить сетевой сбой/5xx (повторяемо)
// от доменной ошибки 4xx (повтор не поможет). status === 0 — сети не было вовсе.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Стоит ли повторять автоматически (см. src/lib/retry.ts). */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

// Потолки ожидания сети (инцидент «мёртвая кнопка», 31.07): «висящий» запрос (сигнал есть, данные не
// идут — мобильный NAT, смена вышки) без таймаута держал busy-состояние кнопок и Web Lock очереди
// НАВСЕГДА. status 0 остаётся retryable → зависшее действие уходит в офлайн-очередь, а не в вечное
// ожидание. Загрузка фото щедрее: ~0.3–0.8 МБ на EDGE.
const REQUEST_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 90_000;

// AbortSignal.timeout есть во всех целевых браузерах (TWA — evergreen Chrome); нет API → без
// таймаута, как раньше (деградация до старого поведения, не падение).
function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

// Обрыв и таймаут различаем в коде ошибки (диагностика), но оба — status 0 (retryable).
function toNetworkError(e: unknown): ApiError {
  const timedOut = e instanceof DOMException && e.name === "TimeoutError";
  return new ApiError(timedOut ? "Сеть не отвечает" : "Нет соединения", 0, timedOut ? "TIMEOUT" : "NETWORK");
}

// Фетчер для SWR: возвращает data из конверта { data } | { error }.
export async function fetcher<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal: timeoutSignal(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    throw toNetworkError(e);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || "error" in body) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const message = body?.error?.message ?? "Ошибка загрузки";
    throw new ApiError(message, res.status, code);
  }
  return body.data as T;
}

/**
 * Отправка мутации (POST/PATCH/DELETE). Возвращает data или бросает ApiError.
 * extraHeaders — для офлайн-досылки: Idempotency-Key (дедупликация повтора) и X-Occurred-At
 * (момент действия на телефоне). См. src/lib/offline.
 */
export async function apiSend<T = unknown>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw toNetworkError(e);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || "error" in json) {
    const code = json?.error?.code ?? `HTTP_${res.status}`;
    throw new ApiError(json?.error?.message ?? "Не удалось сохранить", res.status, code);
  }
  return json.data as T;
}

/** Загрузка файла multipart (Content-Type ставит браузер сам — с boundary). Бросает ApiError. */
export async function apiUpload<T = unknown>(
  url: string,
  form: FormData,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, headers: extraHeaders, signal: timeoutSignal(UPLOAD_TIMEOUT_MS) });
  } catch (e) {
    throw toNetworkError(e);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || "error" in json) {
    const code = json?.error?.code ?? `HTTP_${res.status}`;
    throw new ApiError(json?.error?.message ?? "Не удалось загрузить фото", res.status, code);
  }
  return json.data as T;
}
