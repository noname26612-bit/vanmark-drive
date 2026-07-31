"use client";
// Отправка клиентских ошибок на сервер (наблюдаемость, 31.07) — fire-and-forget, без ретраев и без
// офлайн-очереди (диагностика не должна порождать трафик-шторм или зависеть от больной очереди).
// keepalive — чтобы репорт уезжал даже при закрытии/перезагрузке страницы.

const DEDUP_WINDOW_MS = 30_000;
const lastSent = new Map<string, number>();

export function reportClientError(err: unknown, context: string): void {
  try {
    const msg =
      err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : JSON.stringify(err);
    const key = `${context}|${msg}`;
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev !== undefined && now - prev < DEDUP_WINDOW_MS) return; // не спамим одинаковым
    lastSent.set(key, now);
    if (lastSent.size > 100) lastSent.clear();

    const body = JSON.stringify({
      msg,
      stack: err instanceof Error ? err.stack : undefined,
      context,
      url: typeof location !== "undefined" ? location.pathname : undefined,
    });
    void fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* диагностика никогда не роняет приложение */
  }
}

/** Глобальные перехватчики window.onerror/unhandledrejection. Возвращает отписку. */
export function attachGlobalReporter(): () => void {
  const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, "window.onerror");
  const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, "unhandledrejection");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
