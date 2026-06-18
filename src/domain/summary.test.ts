import { describe, it, expect } from "vitest";
import {
  isGranularity,
  normalizeAnchor,
  windowKeys,
  shiftAnchor,
  inWindow,
  coarseUtcRange,
  averageMinutes,
  formatWindowLabel,
} from "./summary";

// ───────────────────────────── Разрез и валидация ─────────────────────────────

describe("summary — разрез периода", () => {
  it("isGranularity распознаёт допустимые значения", () => {
    expect(isGranularity("day")).toBe(true);
    expect(isGranularity("week")).toBe(true);
    expect(isGranularity("month")).toBe(true);
    expect(isGranularity("year")).toBe(false);
    expect(isGranularity("")).toBe(false);
  });
});

// ───────────────────────────── Окно периода ─────────────────────────────

describe("summary — windowKeys", () => {
  it("день — окно из одного дня", () => {
    expect(windowKeys("day", "2026-06-18")).toEqual({ fromKey: "2026-06-18", toKey: "2026-06-18" });
  });

  it("неделя — понедельник…воскресенье, содержащие якорь (чт 18.06.2026)", () => {
    // 18 июня 2026 — четверг; неделя пн 15.06 … вс 21.06
    expect(windowKeys("week", "2026-06-18")).toEqual({ fromKey: "2026-06-15", toKey: "2026-06-21" });
  });

  it("неделя от воскресенья берёт ту же неделю (вс 21.06 → пн 15.06)", () => {
    expect(windowKeys("week", "2026-06-21")).toEqual({ fromKey: "2026-06-15", toKey: "2026-06-21" });
  });

  it("неделя от понедельника начинается с него (пн 15.06)", () => {
    expect(windowKeys("week", "2026-06-15")).toEqual({ fromKey: "2026-06-15", toKey: "2026-06-21" });
  });

  it("месяц — первый…последний день месяца якоря", () => {
    expect(windowKeys("month", "2026-06-18")).toEqual({ fromKey: "2026-06-01", toKey: "2026-06-30" });
    // февраль 2024 — високосный
    expect(windowKeys("month", "2024-02-10")).toEqual({ fromKey: "2024-02-01", toKey: "2024-02-29" });
    // февраль 2026 — обычный
    expect(windowKeys("month", "2026-02-10")).toEqual({ fromKey: "2026-02-01", toKey: "2026-02-28" });
  });
});

describe("summary — normalizeAnchor", () => {
  it("неделю нормализует к понедельнику, месяц к 1-му числу, день оставляет", () => {
    expect(normalizeAnchor("week", "2026-06-18")).toBe("2026-06-15");
    expect(normalizeAnchor("month", "2026-06-18")).toBe("2026-06-01");
    expect(normalizeAnchor("day", "2026-06-18")).toBe("2026-06-18");
  });
});

// ───────────────────────────── Листание ─────────────────────────────

describe("summary — shiftAnchor", () => {
  it("день ±1 сутки", () => {
    expect(shiftAnchor("day", "2026-06-18", 1)).toBe("2026-06-19");
    expect(shiftAnchor("day", "2026-06-01", -1)).toBe("2026-05-31");
  });

  it("неделя ±7 суток от понедельника недели", () => {
    expect(shiftAnchor("week", "2026-06-18", -1)).toBe("2026-06-08"); // пред. неделя, понедельник
    expect(shiftAnchor("week", "2026-06-18", 1)).toBe("2026-06-22");
  });

  it("месяц ±календарный месяц, к 1-му числу (через границу года)", () => {
    expect(shiftAnchor("month", "2026-06-18", 1)).toBe("2026-07-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
});

// ───────────────────────────── Попадание в окно ─────────────────────────────

describe("summary — inWindow", () => {
  const w = windowKeys("week", "2026-06-18"); // 15…21
  it("границы включительно", () => {
    expect(inWindow("2026-06-15", w)).toBe(true);
    expect(inWindow("2026-06-21", w)).toBe(true);
  });
  it("вне окна — false", () => {
    expect(inWindow("2026-06-14", w)).toBe(false);
    expect(inWindow("2026-06-22", w)).toBe(false);
  });
});

describe("summary — coarseUtcRange", () => {
  it("даёт суточный запас с каждой стороны окна", () => {
    const r = coarseUtcRange({ fromKey: "2026-06-15", toKey: "2026-06-21" });
    expect(r.gte.toISOString()).toBe("2026-06-14T00:00:00.000Z");
    expect(r.lt.toISOString()).toBe("2026-06-23T00:00:00.000Z");
  });
});

// ───────────────────────────── Среднее время ─────────────────────────────

describe("summary — averageMinutes", () => {
  it("пустой список → null (без деления на ноль)", () => {
    expect(averageMinutes([])).toBeNull();
  });
  it("среднее в минутах с округлением", () => {
    // 60 мин и 30 мин → 45
    expect(averageMinutes([60 * 60000, 30 * 60000])).toBe(45);
    // 72 мин → 72
    expect(averageMinutes([72 * 60000])).toBe(72);
  });
});

// ───────────────────────────── Заголовок периода ─────────────────────────────

describe("summary — formatWindowLabel", () => {
  it("день — дд.мм.гггг", () => {
    expect(formatWindowLabel("day", "2026-06-18")).toBe("18.06.2026");
  });
  it("неделя — дд.мм – дд.мм.гггг", () => {
    expect(formatWindowLabel("week", "2026-06-18")).toBe("15.06 – 21.06.2026");
  });
  it("месяц — название и год", () => {
    expect(formatWindowLabel("month", "2026-06-18")).toBe("июнь 2026");
  });
});
