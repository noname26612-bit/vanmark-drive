import { describe, it, expect } from "vitest";
import { formatDuration } from "./format-duration";

describe("format-duration", () => {
  it("нет данных — прочерк (не ноль): смен могло не быть вовсе", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });

  it("минуты, часы и часы с минутами", () => {
    expect(formatDuration(0)).toBe("0 мин");
    expect(formatDuration(34)).toBe("34 мин");
    expect(formatDuration(120)).toBe("2 ч");
    expect(formatDuration(72)).toBe("1 ч 12 мин");
  });

  it("отрицательные минуты не печатаются как «минус» — считаем нулём", () => {
    expect(formatDuration(-5)).toBe("0 мин");
  });
});
