import { describe, it, expect } from "vitest";
import { unionDurationMs } from "./intervals";

const MIN = 60_000;
const iv = (startMin: number, endMin: number) => ({ start: startMin * MIN, end: endMin * MIN });

describe("unionDurationMs — объединение интервалов занятости", () => {
  it("пусто и мусор (end <= start) → 0", () => {
    expect(unionDurationMs([])).toBe(0);
    expect(unionDurationMs([iv(10, 10), iv(20, 5)])).toBe(0);
  });

  it("один интервал — его длительность", () => {
    expect(unionDurationMs([iv(0, 30)])).toBe(30 * MIN);
  });

  it("раздельные складываются", () => {
    expect(unionDurationMs([iv(0, 30), iv(60, 90)])).toBe(60 * MIN);
  });

  it("пересекающиеся не задваиваются (кейс напарника: парная параллельно своей)", () => {
    // Своя задача 9:00–12:00, парная 10:00–11:00 — отработано 3 часа, не 4.
    expect(unionDurationMs([iv(0, 180), iv(60, 120)])).toBe(180 * MIN);
  });

  it("смежные схлопываются без зазора", () => {
    expect(unionDurationMs([iv(0, 60), iv(60, 120)])).toBe(120 * MIN);
  });

  it("вложенные и неотсортированные", () => {
    expect(unionDurationMs([iv(50, 60), iv(0, 100), iv(10, 20)])).toBe(100 * MIN);
  });
});
