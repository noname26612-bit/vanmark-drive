// Фетчер для SWR: возвращает data из конверта { data } | { error }.
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || "error" in body) {
    const message = body?.error?.message ?? "Ошибка загрузки";
    throw new Error(message);
  }
  return body.data as T;
}

/** Отправка мутации (POST/PATCH). Возвращает data или бросает Error с текстом из { error }. */
export async function apiSend<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || "error" in json) {
    throw new Error(json?.error?.message ?? "Не удалось сохранить");
  }
  return json.data as T;
}
