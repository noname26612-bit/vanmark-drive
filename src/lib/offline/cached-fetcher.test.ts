import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем IndexedDB-обёртку, чтобы проверить связку «точный ключ + стабильный latest:-ключ»
// (наутро офлайн, O7) без браузера. Чистая fetchWithCache тестируется ниже без моков.
const { idbGet, idbPut } = vi.hoisted(() => ({ idbGet: vi.fn(), idbPut: vi.fn() }));
vi.mock("./db", () => ({ idbGet, idbPut, STORE_RESPONSES: "responses" }));

import { fetchWithCache, stableKey, readCachedMeta } from "./cached-fetcher";
import { ApiError } from "@/lib/fetcher";

const net0 = () => Promise.reject(new ApiError("нет связи", 0, "NETWORK")); // нет сети

describe("fetchWithCache", () => {
  it("сеть успешна → возвращает данные и кэширует", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(undefined);
    const data = await fetchWithCache("/u", async () => ({ a: 1 }), get, put);
    expect(data).toEqual({ a: 1 });
    expect(put).toHaveBeenCalledWith("/u", { a: 1 });
  });

  it("нет сети → отдаёт сохранённое из кэша", async () => {
    const get = vi.fn().mockResolvedValue({ a: 2 });
    const data = await fetchWithCache("/u", net0, get, async () => {});
    expect(data).toEqual({ a: 2 });
  });

  it("нет сети и кэш пуст → пробрасывает сетевую ошибку", async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    await expect(fetchWithCache("/u", net0, get, async () => {})).rejects.toBeInstanceOf(ApiError);
  });

  it("доменная ошибка (4xx) → пробрасывает, кэш даже не читаем", async () => {
    const net = () => Promise.reject(new ApiError("нельзя", 409, "CONFLICT"));
    const get = vi.fn().mockResolvedValue({ a: 3 });
    await expect(fetchWithCache("/u", net, get, async () => {})).rejects.toThrow("нельзя");
    expect(get).not.toHaveBeenCalled();
  });

  it("сбой записи в кэш не ломает успешный ответ сети", async () => {
    const put = vi.fn().mockRejectedValue(new Error("IDB упал"));
    const data = await fetchWithCache("/u", async () => ({ ok: true }), async () => undefined, put);
    expect(data).toEqual({ ok: true });
  });
});

describe("stableKey — стабильный ключ без date (наутро офлайн, O7)", () => {
  it("вырезает date, сохраняя остальные параметры", () => {
    expect(stableKey("/api/my/tasks?date=2026-07-01&scope=today")).toBe("latest:/api/my/tasks?scope=today");
    expect(stableKey("/api/my/shift?date=2026-07-01")).toBe("latest:/api/my/shift");
  });

  it("вкладки не смешиваются: scope остаётся в ключе", () => {
    expect(stableKey("/api/my/tasks?date=2026-07-01&scope=today")).not.toBe(
      stableKey("/api/my/tasks?date=2026-07-01&scope=upcoming"),
    );
  });

  it("URL без date (или без query) → null, вторая запись не нужна", () => {
    expect(stableKey("/api/tasks/abc")).toBeNull();
    expect(stableKey("/api/work-catalog?full=1")).toBeNull();
  });
});

describe("readCachedMeta — точный ключ, затем latest:-фолбэк", () => {
  beforeEach(() => {
    idbGet.mockReset();
    idbPut.mockReset();
  });

  it("наутро: точный ключ (новая дата) пуст → отдаёт вчерашний ответ по стабильному ключу", async () => {
    const yesterday = { data: [{ id: "t1" }], cachedAt: "2026-07-01T18:45:00.000Z" };
    idbGet.mockImplementation(async (_store: string, key: string) =>
      key === "latest:/api/my/tasks?scope=today" ? yesterday : undefined,
    );
    const meta = await readCachedMeta("/api/my/tasks?date=2026-07-02&scope=today");
    expect(meta).toEqual(yesterday);
  });

  it("точный ключ есть → приоритет у него (свежее сегодняшнего latest)", async () => {
    const exact = { data: "today", cachedAt: "2026-07-02T08:00:00.000Z" };
    idbGet.mockImplementation(async (_store: string, key: string) =>
      key === "/api/my/tasks?date=2026-07-02&scope=today" ? exact : { data: "stale", cachedAt: "x" },
    );
    const meta = await readCachedMeta("/api/my/tasks?date=2026-07-02&scope=today");
    expect(meta?.data).toBe("today");
  });

  it("нет ни точного, ни стабильного → undefined", async () => {
    idbGet.mockResolvedValue(undefined);
    expect(await readCachedMeta("/api/my/tasks?date=2026-07-02&scope=today")).toBeUndefined();
  });
});
