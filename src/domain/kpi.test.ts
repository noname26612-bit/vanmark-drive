import { describe, it, expect } from "vitest";
import {
  periodOf,
  dateKeyInTz,
  utcDateKey,
  noonUtc,
  parseHHMM,
  progressionMultiplier,
  detectLate,
  detectUnsignedDoc,
  detectMissedStop,
  computePay,
  computeActBonus,
  periodBoundsUtc,
  type CalcConfig,
  type CalcMark,
} from "./kpi";

const TZ = "Europe/Moscow"; // фиксированный UTC+3

// ───────────────────────────── Утилиты времени ─────────────────────────────

describe("kpi — утилиты времени/периода", () => {
  it("periodOf/dateKeyInTz считают по московской зоне (граница месяца)", () => {
    // 30 июня 22:30 UTC = 1 июля 01:30 МСК
    const instant = new Date("2026-06-30T22:30:00.000Z");
    expect(dateKeyInTz(instant, TZ)).toBe("2026-07-01");
    expect(periodOf(instant, TZ)).toBe("2026-07");
    // 30 июня 20:00 UTC = 30 июня 23:00 МСК
    expect(periodOf(new Date("2026-06-30T20:00:00.000Z"), TZ)).toBe("2026-06");
  });

  it("utcDateKey берёт календарную дату @db.Date без сдвига зоны", () => {
    expect(utcDateKey(new Date("2026-06-03T00:00:00.000Z"))).toBe("2026-06-03");
  });

  it("noonUtc даёт полдень UTC указанного дня", () => {
    expect(noonUtc("2026-06-03").toISOString()).toBe("2026-06-03T12:00:00.000Z");
  });

  it("parseHHMM разбирает время, в т.ч. внутри текста", () => {
    expect(parseHHMM("17:00")).toBe(1020);
    expect(parseHHMM("09:00")).toBe(540);
    expect(parseHHMM("до 17:00")).toBe(1020);
    expect(parseHHMM("")).toBeNull();
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM("после обеда")).toBeNull();
    expect(parseHHMM("25:00")).toBeNull();
    expect(parseHHMM("12:75")).toBeNull();
  });

  it("progressionMultiplier: до startIndex множитель 1, затем геометрия", () => {
    // ×1.10 начиная с 3-й (ответ Артёма)
    expect(progressionMultiplier(1, 110, 3)).toBeCloseTo(1, 10);
    expect(progressionMultiplier(2, 110, 3)).toBeCloseTo(1, 10);
    expect(progressionMultiplier(3, 110, 3)).toBeCloseTo(1.1, 10);
    expect(progressionMultiplier(4, 110, 3)).toBeCloseTo(1.21, 10);
    // ×1.25 с каждой следующей (параметры PRD §12.3)
    expect(progressionMultiplier(1, 125, 2)).toBeCloseTo(1, 10);
    expect(progressionMultiplier(2, 125, 2)).toBeCloseTo(1.25, 10);
    expect(progressionMultiplier(3, 125, 2)).toBeCloseTo(1.5625, 10);
  });
});

// ───────────────────────────── Детектор: опоздание ─────────────────────────────

describe("kpi — detectLate", () => {
  const base = {
    driverId: "d1",
    taskId: "t1",
    scheduledDate: new Date("2026-06-03T00:00:00.000Z"),
    timeTo: "17:00",
  };

  it("приезд позже окна в тот же день — нарушение", () => {
    const c = detectLate({ ...base, onSiteAt: new Date("2026-06-03T15:30:00.000Z") }, TZ); // 18:30 МСК
    expect(c?.kind).toBe("LATE");
    expect(c?.occurredAt.toISOString()).toBe("2026-06-03T15:30:00.000Z");
    expect(c?.period).toBe("2026-06");
  });

  it("приезд в пределах окна — нет нарушения", () => {
    expect(detectLate({ ...base, onSiteAt: new Date("2026-06-03T10:00:00.000Z") }, TZ)).toBeNull(); // 13:00 МСК
  });

  it("приезд на следующий день — нарушение независимо от времени", () => {
    const c = detectLate({ ...base, onSiteAt: new Date("2026-06-04T05:00:00.000Z") }, TZ); // 08:00 МСК 4-го
    expect(c?.kind).toBe("LATE");
  });

  it("нет окна времени / нечитаемое — пропускаем", () => {
    expect(detectLate({ ...base, timeTo: null, onSiteAt: new Date("2026-06-03T20:00:00.000Z") }, TZ)).toBeNull();
    expect(detectLate({ ...base, timeTo: "вечером", onSiteAt: new Date("2026-06-03T20:00:00.000Z") }, TZ)).toBeNull();
  });

  it("не приехал (нет onSiteAt) или нет водителя — нет нарушения", () => {
    expect(detectLate({ ...base, onSiteAt: null }, TZ)).toBeNull();
    expect(detectLate({ ...base, driverId: null, onSiteAt: new Date("2026-06-03T20:00:00.000Z") }, TZ)).toBeNull();
  });

  it("без даты задачи опирается на день фактического приезда", () => {
    const c = detectLate(
      { driverId: "d1", taskId: "t1", scheduledDate: null, timeTo: "17:00", onSiteAt: new Date("2026-06-03T16:00:00.000Z") }, // 19:00 МСК
      TZ,
    );
    expect(c?.kind).toBe("LATE");
  });
});

// ───────────────────────────── Детектор: без акта ─────────────────────────────

describe("kpi — detectUnsignedDoc", () => {
  const base = {
    driverId: "d1",
    taskId: "t1",
    requiresSignedDoc: true,
    status: "DONE",
    completedAt: new Date("2026-06-05T09:00:00.000Z"),
  };

  it("ремонтная завершена без акта — нарушение", () => {
    const c = detectUnsignedDoc({ ...base, hasSignedDoc: false }, TZ);
    expect(c?.kind).toBe("UNSIGNED_DOCS");
    expect(c?.period).toBe("2026-06");
    expect(c?.occurredAt.toISOString()).toBe("2026-06-05T09:00:00.000Z");
  });

  it("есть акт — нет нарушения", () => {
    expect(detectUnsignedDoc({ ...base, hasSignedDoc: true }, TZ)).toBeNull();
  });

  it("не ремонтный тип — метрика не применяется", () => {
    expect(detectUnsignedDoc({ ...base, requiresSignedDoc: false, hasSignedDoc: false }, TZ)).toBeNull();
  });

  it("ещё не завершена — нет нарушения", () => {
    expect(detectUnsignedDoc({ ...base, status: "IN_PROGRESS", hasSignedDoc: false }, TZ)).toBeNull();
  });
});

// ───────────────────────────── Детектор: невыполненная точка ─────────────────────────────

describe("kpi — detectMissedStop", () => {
  const asOf = new Date("2026-06-10T20:30:00.000Z"); // 23:30 МСК 10 июня
  const base = { driverId: "d1", taskId: "t1", scheduledDate: new Date("2026-06-10T00:00:00.000Z") };

  it("назначенная на наступивший день и не доведена — нарушение", () => {
    const c = detectMissedStop({ ...base, status: "ASSIGNED" }, asOf, TZ);
    expect(c?.kind).toBe("MISSED_STOP");
    expect(c?.period).toBe("2026-06");
    expect(c?.occurredAt.toISOString()).toBe("2026-06-10T12:00:00.000Z");
  });

  it("выполнена/отменена/перенесена — не нарушение", () => {
    expect(detectMissedStop({ ...base, status: "DONE" }, asOf, TZ)).toBeNull();
    expect(detectMissedStop({ ...base, status: "CANCELLED" }, asOf, TZ)).toBeNull();
    expect(detectMissedStop({ ...base, status: "RESCHEDULED" }, asOf, TZ)).toBeNull();
  });

  it("день ещё не наступил — нет нарушения", () => {
    const future = { ...base, scheduledDate: new Date("2026-06-15T00:00:00.000Z"), status: "ASSIGNED" };
    expect(detectMissedStop(future, asOf, TZ)).toBeNull();
  });

  it("без даты — точки дня нет", () => {
    expect(detectMissedStop({ ...base, scheduledDate: null, status: "ASSIGNED" }, asOf, TZ)).toBeNull();
  });
});

// ───────────────────────────── Прогрессивный расчёт ─────────────────────────────

const mark = (kind: CalcMark["kind"], iso: string, manualAmount?: number): CalcMark => ({
  id: iso + kind,
  kind,
  occurredAt: new Date(iso),
  manualAmount,
});

// Параметры из примера PRD §12.3 (исторические).
const PRD_CONFIG: CalcConfig = {
  weights: { LATE: 1000, UNSIGNED_DOCS: 3000, MISSED_STOP: 2000 },
  progressionPercent: 125,
  progressionStartIndex: 2,
  floor: "ZERO",
};

// Параметры, зафиксированные Артёмом 17.06.2026.
const ARTEM_CONFIG: CalcConfig = {
  weights: { LATE: 500, UNSIGNED_DOCS: 1000, MISSED_STOP: 500 },
  progressionPercent: 110,
  progressionStartIndex: 3,
  floor: "SALARY",
};

describe("kpi — computePay: пример PRD §12.3", () => {
  it("0 ошибок = полная премия (60 000)", () => {
    const r = computePay({ baseSalary: 50_000, premiumBase: 10_000, marks: [], config: PRD_CONFIG });
    expect(r.penalty).toBe(0);
    expect(r.total).toBe(60_000);
  });

  it("2 опоздания = 57 750 (прогрессия ×1.25)", () => {
    const r = computePay({
      baseSalary: 50_000,
      premiumBase: 10_000,
      marks: [mark("LATE", "2026-06-05T09:00:00Z"), mark("LATE", "2026-06-12T09:00:00Z")],
      config: PRD_CONFIG,
    });
    expect(r.penalty).toBe(2_250); // 1000 + 1250
    expect(r.total).toBe(57_750);
  });
});

describe("kpi — computePay: параметры Артёма (floor=SALARY)", () => {
  it("0 ошибок = оклад + полная премия (110 000)", () => {
    const r = computePay({ baseSalary: 70_000, premiumBase: 40_000, marks: [], config: ARTEM_CONFIG });
    expect(r.total).toBe(110_000);
  });

  it("прогрессия включается с 3-й ошибки", () => {
    const r = computePay({
      baseSalary: 70_000,
      premiumBase: 40_000,
      marks: [
        mark("LATE", "2026-06-02T09:00:00Z"),
        mark("LATE", "2026-06-05T09:00:00Z"),
        mark("LATE", "2026-06-09T09:00:00Z"),
        mark("LATE", "2026-06-12T09:00:00Z"),
      ],
      config: ARTEM_CONFIG,
    });
    // 500 + 500 + 550 + 605
    expect(r.penalty).toBe(2_155);
    expect(r.total).toBe(70_000 + (40_000 - 2_155));
  });

  it("штрафы максимум обнуляют премию — итог не ниже оклада", () => {
    const r = computePay({
      baseSalary: 70_000,
      premiumBase: 40_000,
      marks: [mark("MANUAL", "2026-06-10T09:00:00Z", -50_000)], // ручной штраф больше премии
      config: ARTEM_CONFIG,
    });
    expect(r.penalty).toBe(50_000);
    expect(r.premiumAfter).toBe(-10_000);
    expect(r.total).toBe(70_000); // не ниже оклада
  });

  it("то же при floor=ZERO режет оклад, но не ниже 0", () => {
    const r = computePay({
      baseSalary: 70_000,
      premiumBase: 40_000,
      marks: [mark("MANUAL", "2026-06-10T09:00:00Z", -50_000)],
      config: { ...ARTEM_CONFIG, floor: "ZERO" },
    });
    expect(r.total).toBe(60_000); // 70000 + (40000 - 50000)
  });

  it("ручное поощрение добавляется сверх премии", () => {
    const r = computePay({
      baseSalary: 70_000,
      premiumBase: 40_000,
      marks: [mark("MANUAL", "2026-06-10T09:00:00Z", 5_000)],
      config: ARTEM_CONFIG,
    });
    expect(r.bonus).toBe(5_000);
    expect(r.total).toBe(115_000);
  });
});

describe("kpi — computePay: порядок и breakdown", () => {
  it("штрафы нумеруются по времени возникновения, не по порядку в массиве", () => {
    const cfg: CalcConfig = {
      weights: { LATE: 1000, UNSIGNED_DOCS: 1000, MISSED_STOP: 1000 },
      progressionPercent: 200, // ×2 для наглядности
      progressionStartIndex: 2,
      floor: "ZERO",
    };
    const r = computePay({
      baseSalary: 0,
      premiumBase: 100_000,
      marks: [
        mark("LATE", "2026-06-20T09:00:00Z"), // позже
        mark("MISSED_STOP", "2026-06-05T09:00:00Z"), // раньше
        mark("UNSIGNED_DOCS", "2026-06-12T09:00:00Z"), // в середине
      ],
      config: cfg,
    });
    // По времени: 05 (×1 → 1000), 12 (×2 → 2000), 20 (×4 → 4000)
    expect(r.penalty).toBe(7_000);
    const penalties = r.breakdown.filter((b) => b.order !== null);
    expect(penalties[0].occurredAt).toBe("2026-06-05T09:00:00.000Z");
    expect(penalties[0].order).toBe(1);
    expect(penalties[2].occurredAt).toBe("2026-06-20T09:00:00.000Z");
  });

  it("breakdown: штрафы со знаком минус, поощрение со знаком плюс", () => {
    const r = computePay({
      baseSalary: 70_000,
      premiumBase: 40_000,
      marks: [
        mark("LATE", "2026-06-03T09:00:00Z"),
        mark("MANUAL", "2026-06-10T09:00:00Z", 5_000),
        mark("MANUAL", "2026-06-15T09:00:00Z", -2_000),
      ],
      config: ARTEM_CONFIG,
    });
    expect(r.penalty).toBe(2_500); // 500 (late) + 2000 (manual penalty)
    expect(r.bonus).toBe(5_000);
    expect(r.total).toBe(70_000 + (40_000 - 2_500) + 5_000);
    expect(r.breakdown).toHaveLength(3);
    const late = r.breakdown.find((b) => b.kind === "LATE");
    expect(late?.amount).toBe(-500);
  });
});

// ───────────────────────────── Бонус за комплектность актов (этап 15, §12.6) ─────────────────────────────

describe("computeActBonus — бонус за комплектность актов", () => {
  const cfg = { thresholdPercent: 80, amount: 5000 };

  it("база 0 (нет актовых задач) → не начисляется, нейтрально", () => {
    const r = computeActBonus({ base: 0, complete: 0, ...cfg });
    expect(r.awarded).toBe(false);
    expect(r.value).toBe(0);
    expect(r.percent).toBe(0);
    expect(r.missing).toBe(0);
  });

  it("пример §12.6: 17/20 = 85% ≥ 80% → +5000", () => {
    const r = computeActBonus({ base: 20, complete: 17, ...cfg });
    expect(r.percent).toBe(85);
    expect(r.awarded).toBe(true);
    expect(r.value).toBe(5000);
    expect(r.missing).toBe(0);
  });

  it("ровно порог: 16/20 = 80% → начисляется (≥ включительно)", () => {
    const r = computeActBonus({ base: 20, complete: 16, ...cfg });
    expect(r.percent).toBe(80);
    expect(r.awarded).toBe(true);
    expect(r.value).toBe(5000);
  });

  it("пример §12.6: 72% → не начислен, «не хватает 2 актов»", () => {
    const r = computeActBonus({ base: 25, complete: 18, ...cfg });
    expect(r.percent).toBe(72);
    expect(r.awarded).toBe(false);
    expect(r.value).toBe(0);
    expect(r.requiredComplete).toBe(20); // ⌈80%·25⌉ = 20
    expect(r.missing).toBe(2);
  });

  it("сравнение точное, не по округлённому проценту: 796/1000 = 79.6% (округляется до 80, но НЕ начисляется)", () => {
    const r = computeActBonus({ base: 1000, complete: 796, ...cfg });
    expect(r.percent).toBe(80); // display округляет
    expect(r.awarded).toBe(false); // но 796 < ⌈0.8·1000⌉ = 800
    expect(r.requiredComplete).toBe(800);
    expect(r.missing).toBe(4);
    expect(computeActBonus({ base: 1000, complete: 800, ...cfg }).awarded).toBe(true);
  });

  it("complete не больше base (защита): 25/20 → клемпится к 20/20 = 100% → начислен", () => {
    const r = computeActBonus({ base: 20, complete: 25, ...cfg });
    expect(r.complete).toBe(20);
    expect(r.percent).toBe(100);
    expect(r.awarded).toBe(true);
  });

  it("сумма 0 (бонус выключен): порог пройден, но начислять нечего", () => {
    const r = computeActBonus({ base: 10, complete: 10, thresholdPercent: 80, amount: 0 });
    expect(r.awarded).toBe(true);
    expect(r.value).toBe(0);
  });
});

describe("periodBoundsUtc — границы месяца (МСК), согласованы с periodOf", () => {
  it("июнь 2026: [start, end) и принадлежность через periodOf", () => {
    const { start, end } = periodBoundsUtc("2026-06");
    // локальная полночь МСК = UTC−3ч
    expect(start.toISOString()).toBe("2026-05-31T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(periodOf(start, TZ)).toBe("2026-06");
    expect(periodOf(new Date(end.getTime() - 1), TZ)).toBe("2026-06");
    expect(periodOf(end, TZ)).toBe("2026-07"); // конец полуинтервала уже в июле
  });

  it("декабрь → переход через год", () => {
    const { start, end } = periodBoundsUtc("2026-12");
    expect(start.toISOString()).toBe("2026-11-30T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-12-31T21:00:00.000Z");
  });
});
