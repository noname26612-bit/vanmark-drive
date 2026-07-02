import { describe, it, expect } from "vitest";
import {
  isGranularity,
  normalizeAnchor,
  windowKeys,
  shiftAnchor,
  inWindow,
  coarseUtcRange,
  averageMinutes,
  windowDayKeys,
  loadPercent,
  idleCostRub,
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

// ───────────────────────────── Сводка v2 (02.07): занятость и деньги ─────────────────────────────

describe("summary v2 — loadPercent", () => {
  it("обычная загрузка: 300 из 480 мин → 63%", () => {
    expect(loadPercent(300, 480)).toBe(63);
  });
  it("смен нет (0 мин) → null, не 0 (нечего считать — не «нулевая загрузка»)", () => {
    expect(loadPercent(120, 0)).toBeNull();
    expect(loadPercent(0, 0)).toBeNull();
  });
  it("отработано больше смены (кривые данные) → больше 100, не ломается", () => {
    expect(loadPercent(600, 480)).toBe(125);
  });
});

describe("summary v2 — windowDayKeys", () => {
  it("день — один ключ; неделя — 7 по порядку", () => {
    expect(windowDayKeys({ fromKey: "2026-06-18", toKey: "2026-06-18" })).toEqual(["2026-06-18"]);
    const week = windowDayKeys({ fromKey: "2026-06-15", toKey: "2026-06-21" });
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2026-06-15");
    expect(week[6]).toBe("2026-06-21");
  });
  it("граница месяца проходит без пропусков", () => {
    expect(windowDayKeys({ fromKey: "2026-06-29", toKey: "2026-07-02" })).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
    ]);
  });
});

describe("summary v2 — idleCostRub", () => {
  it("90 мин при окладе 70 400 и норме 176 ч (400 ₽/ч) → 600 ₽", () => {
    expect(idleCostRub(90, 70_400, 176)).toBe(600);
  });
  it("нулевые/кривые входы → 0", () => {
    expect(idleCostRub(0, 70_400, 176)).toBe(0);
    expect(idleCostRub(90, 0, 176)).toBe(0);
    expect(idleCostRub(90, 70_400, 0)).toBe(0);
  });
});
