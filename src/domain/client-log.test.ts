// Unit на приём клиентских ошибок (наблюдаемость, 31.07): клэмпы недоверенного тела и rate-limit.
import { describe, it, expect } from "vitest";
import {
  sanitizeClientLog,
  rateAllow,
  MSG_MAX,
  STACK_MAX,
  RATE_MAX,
  RATE_WINDOW_MS,
  type RateEntry,
} from "./client-log";

describe("sanitizeClientLog", () => {
  it("нормальное тело → все поля с клэмпом", () => {
    const e = sanitizeClientLog({ msg: " boom ", stack: "at x", context: "offline-queue", url: "/m/1" });
    expect(e).toEqual({ msg: "boom", stack: "at x", context: "offline-queue", url: "/m/1" });
  });

  it("без msg (или не строка) → null, писать нечего", () => {
    expect(sanitizeClientLog({})).toBeNull();
    expect(sanitizeClientLog({ msg: "   " })).toBeNull();
    expect(sanitizeClientLog({ msg: 42 })).toBeNull();
  });

  it("длинные поля обрезаются до потолков", () => {
    const e = sanitizeClientLog({ msg: "x".repeat(MSG_MAX * 2), stack: "y".repeat(STACK_MAX * 2) });
    expect(e?.msg.length).toBe(MSG_MAX);
    expect(e?.stack?.length).toBe(STACK_MAX);
  });

  it("посторонние поля отбрасываются (в лог не утекают)", () => {
    const e = sanitizeClientLog({ msg: "m", password: "secret", token: "t" });
    expect(e).toEqual({ msg: "m" });
  });
});

describe("rateAllow", () => {
  const NOW = 1_000_000;

  it("первые RATE_MAX записей проходят, следующая — нет", () => {
    let entry: RateEntry = { stamps: [] };
    for (let i = 0; i < RATE_MAX; i++) {
      const r = rateAllow(entry, NOW + i);
      expect(r.allowed).toBe(true);
      entry = r.entry;
    }
    expect(rateAllow(entry, NOW + RATE_MAX).allowed).toBe(false);
  });

  it("после окна счётчик очищается", () => {
    const full: RateEntry = { stamps: Array.from({ length: RATE_MAX }, (_, i) => NOW + i) };
    expect(rateAllow(full, NOW + RATE_WINDOW_MS + 1000).allowed).toBe(true);
  });
});
