// Unit на таймауты и маппинг сетевых ошибок fetcher-а (инцидент «мёртвая кнопка», 31.07): зависший
// fetch без таймаута держал busy-кнопки и Web Lock очереди навсегда. Реальные 15/90 секунд не ждём —
// проверяем, что fetch получает AbortSignal, а TimeoutError/обрыв маппятся в правильные ApiError.
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetcher, apiSend, apiUpload, ApiError } from "./fetcher";

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("таймауты fetch", () => {
  it("apiSend передаёт AbortSignal в fetch (потолок ожидания есть)", async () => {
    const spy = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(async () => okResponse({ ok: 1 }));
    vi.stubGlobal("fetch", spy);
    await apiSend("/api/x", "POST", { a: 1 });
    expect(spy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fetcher и apiUpload тоже передают AbortSignal", async () => {
    const spy = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(async () => okResponse({ ok: 1 }));
    vi.stubGlobal("fetch", spy);
    await fetcher("/api/x");
    await apiUpload("/api/x", new FormData());
    for (const call of spy.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("TimeoutError аборта → ApiError(status 0, code TIMEOUT, retryable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out", "TimeoutError");
      }),
    );
    const err = await apiSend("/api/x", "POST").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).code).toBe("TIMEOUT");
    expect((err as ApiError).retryable).toBe(true);
  });

  it("обрыв сети (TypeError) → ApiError(status 0, code NETWORK, retryable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await fetcher("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).code).toBe("NETWORK");
    expect((err as ApiError).retryable).toBe(true);
  });

  it("успешный ответ разворачивается из конверта { data }", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ id: "t1" })));
    await expect(apiSend("/api/x", "POST")).resolves.toEqual({ id: "t1" });
  });

  it("доменная ошибка сервера маппится в ApiError с кодом и статусом", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "PAYMENT_REQUIRED", message: "Отметьте оплату" } }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const err = await apiSend("/api/x", "POST").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).code).toBe("PAYMENT_REQUIRED");
    expect((err as ApiError).retryable).toBe(false);
  });
});
