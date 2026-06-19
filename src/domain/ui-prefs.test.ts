import { describe, it, expect } from "vitest";
import { sanitizeKeyArray, isUiPrefKey, UI_PREF_KEYS } from "./ui-prefs";

describe("sanitizeKeyArray", () => {
  it("оставляет валидные строки в порядке", () => {
    expect(sanitizeKeyArray(["undated", "upcoming", "driver:abc"])).toEqual([
      "undated",
      "upcoming",
      "driver:abc",
    ]);
  });

  it("не массив → пустой массив", () => {
    expect(sanitizeKeyArray(null)).toEqual([]);
    expect(sanitizeKeyArray("undated")).toEqual([]);
    expect(sanitizeKeyArray({ 0: "x" })).toEqual([]);
  });

  it("выкидывает нестроки, пустые и слишком длинные значения", () => {
    const long = "x".repeat(101);
    expect(sanitizeKeyArray(["ok", 1, null, "", long, true])).toEqual(["ok"]);
  });

  it("убирает дубли, сохраняя первый порядок", () => {
    expect(sanitizeKeyArray(["a", "b", "a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("ограничивает количество элементов", () => {
    const many = Array.from({ length: 200 }, (_, i) => `k${i}`);
    expect(sanitizeKeyArray(many)).toHaveLength(100);
  });
});

describe("isUiPrefKey", () => {
  it("принимает только ключи из белого списка", () => {
    for (const k of UI_PREF_KEYS) expect(isUiPrefKey(k)).toBe(true);
    expect(isUiPrefKey("board.evil")).toBe(false);
    expect(isUiPrefKey("")).toBe(false);
  });
});
