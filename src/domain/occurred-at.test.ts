import { describe, it, expect } from "vitest";
import { resolveOccurredAt } from "./occurred-at";

const NOW = new Date("2026-06-23T12:00:00.000Z");

describe("resolveOccurredAt", () => {
  it("нет значения → время сервера", () => {
    expect(resolveOccurredAt(null, NOW)).toEqual(NOW);
    expect(resolveOccurredAt(undefined, NOW)).toEqual(NOW);
    expect(resolveOccurredAt("", NOW)).toEqual(NOW);
  });

  it("мусор/некорректная дата → время сервера", () => {
    expect(resolveOccurredAt("не дата", NOW)).toEqual(NOW);
    expect(resolveOccurredAt("2026-13-99", NOW)).toEqual(NOW);
  });

  it("валидное недавнее время (офлайн 2 часа назад) → принимаем как есть", () => {
    const twoHoursAgo = "2026-06-23T10:00:00.000Z";
    expect(resolveOccurredAt(twoHoursAgo, NOW)).toEqual(new Date(twoHoursAgo));
  });

  it("время в будущем за пределами допуска → время сервера (защита от перевода часов)", () => {
    const future = "2026-06-23T13:00:00.000Z"; // +1 час
    expect(resolveOccurredAt(future, NOW)).toEqual(NOW);
  });

  it("небольшой рассинхрон вперёд (в пределах 2 мин) → принимаем", () => {
    const slightlyAhead = "2026-06-23T12:01:00.000Z"; // +1 мин
    expect(resolveOccurredAt(slightlyAhead, NOW)).toEqual(new Date(slightlyAhead));
  });

  it("слишком старое (>36ч) → время сервера", () => {
    const old = "2026-06-21T11:00:00.000Z"; // ~49 ч назад
    expect(resolveOccurredAt(old, NOW)).toEqual(NOW);
  });

  it("ровно на границе 36ч назад → принимаем", () => {
    const at36h = new Date(NOW.getTime() - 36 * 60 * 60 * 1000).toISOString();
    expect(resolveOccurredAt(at36h, NOW)).toEqual(new Date(at36h));
  });
});
