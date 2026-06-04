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

// Фетчер для SWR: возвращает data из конверта { data } | { error }.
export async function fetcher<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError("Нет соединения", 0, "NETWORK");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || "error" in body) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const message = body?.error?.message ?? "Ошибка загрузки";
    throw new ApiError(message, res.status, code);
  }
  return body.data as T;
}

/** Отправка мутации (POST/PATCH/DELETE). Возвращает data или бросает ApiError. */
export async function apiSend<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Нет соединения", 0, "NETWORK");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || "error" in json) {
    const code = json?.error?.code ?? `HTTP_${res.status}`;
    throw new ApiError(json?.error?.message ?? "Не удалось сохранить", res.status, code);
  }
  return json.data as T;
}

/** Загрузка файла multipart (Content-Type ставит браузер сам — с boundary). Бросает ApiError. */
export async function apiUpload<T = unknown>(url: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch {
    throw new ApiError("Нет соединения", 0, "NETWORK");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || "error" in json) {
    const code = json?.error?.code ?? `HTTP_${res.status}`;
    throw new ApiError(json?.error?.message ?? "Не удалось загрузить фото", res.status, code);
  }
  return json.data as T;
}
