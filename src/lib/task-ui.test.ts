import { describe, it, expect } from "vitest";
import { addDaysISO } from "./task-ui";

describe("addDaysISO (горизонт доски/планирования)", () => {
  it("прибавляет дни внутри месяца", () => {
    expect(addDaysISO("2026-06-17", 2)).toBe("2026-06-19");
  });

  it("ноль дней — та же дата", () => {
    expect(addDaysISO("2026-06-17", 0)).toBe("2026-06-17");
  });

  it("переход через конец месяца", () => {
    expect(addDaysISO("2026-06-30", 2)).toBe("2026-07-02");
  });

  it("переход через конец года", () => {
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("некорректная строка возвращается как есть", () => {
    expect(addDaysISO("не дата", 2)).toBe("не дата");
  });
});
