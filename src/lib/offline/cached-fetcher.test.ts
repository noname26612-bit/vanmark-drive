import { describe, it, expect, vi } from "vitest";
import { fetchWithCache } from "./cached-fetcher";
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
