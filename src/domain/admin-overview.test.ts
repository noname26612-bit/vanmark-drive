import { describe, it, expect } from "vitest";
import {
  buildAttentionTiles,
  currentAbsences,
  prevPeriod,
  soonBirthdays,
  type AttentionInput,
} from "./admin-overview";

const EMPTY: AttentionInput = {
  staleShifts: 0,
  overdue: 0,
  tomorrowPasses: 0,
  kpiCandidates: 0,
  prevPeriodOpen: null,
  machinesDuePressing: 0,
  machinesUrgent: 0,
  seamersDuePressing: 0,
  seamersUrgent: 0,
  birthdaysSoon: 0,
  absencesNow: 0,
};

describe("admin-overview: buildAttentionTiles", () => {
  it("всё по нулям — ни одной плашки (ряд нулей приучает не смотреть на блок)", () => {
    expect(buildAttentionTiles(EMPTY)).toEqual([]);
  });

  it("показывает только ненулевое", () => {
    const tiles = buildAttentionTiles({ ...EMPTY, overdue: 2, machinesUrgent: 1 });
    expect(tiles.map((t) => t.key)).toEqual(["overdue", "machines-urgent"]);
  });

  it("порядок: сначала работа дня, потом расчёт, оборудование и люди", () => {
    const tiles = buildAttentionTiles({
      ...EMPTY,
      staleShifts: 1,
      overdue: 1,
      tomorrowPasses: 1,
      kpiCandidates: 1,
      prevPeriodOpen: { period: "2026-07" },
      machinesDuePressing: 1,
      birthdaysSoon: 1,
    });
    expect(tiles.map((t) => t.key)).toEqual([
      "stale-shifts",
      "overdue",
      "tomorrow-passes",
      "kpi-candidates",
      "period-open",
      "machines-due",
      "birthdays",
    ]);
  });

  it("красный — только у просроченных заявок, остальное янтарное (цвет = смысл)", () => {
    const tiles = buildAttentionTiles({
      ...EMPTY,
      overdue: 1,
      staleShifts: 1,
      machinesUrgent: 3,
      absencesNow: 1,
    });
    expect(tiles.filter((t) => t.tone === "red").map((t) => t.key)).toEqual(["overdue"]);
  });

  it("плашки ведут на нужный экран с готовым фильтром", () => {
    const tiles = buildAttentionTiles({
      ...EMPTY,
      machinesDuePressing: 1,
      seamersUrgent: 1,
      prevPeriodOpen: { period: "2026-07" },
    });
    const byKey = Object.fromEntries(tiles.map((t) => [t.key, t.href]));
    expect(byKey["machines-due"]).toBe("/machines?flag=duePressing");
    expect(byKey["seamers-urgent"]).toBe("/seamers?flag=urgent");
    expect(byKey["period-open"]).toBe("/kpi?period=2026-07");
  });

  it("незакрытый месяц не показывается, когда считать некого (prevPeriodOpen=null)", () => {
    const tiles = buildAttentionTiles({ ...EMPTY, kpiCandidates: 1, prevPeriodOpen: null });
    expect(tiles.map((t) => t.key)).toEqual(["kpi-candidates"]);
  });
});

describe("admin-overview: prevPeriod", () => {
  it("предыдущий месяц, в том числе через год", () => {
    expect(prevPeriod("2026-08")).toBe("2026-07");
    expect(prevPeriod("2026-01")).toBe("2025-12");
  });
});

describe("admin-overview: soonBirthdays", () => {
  it("берёт сегодня и ближайшие дни, дальние отбрасывает", () => {
    const list = [{ inDays: 0 }, { inDays: 7 }, { inDays: 8 }, { inDays: 40 }];
    expect(soonBirthdays(list, 7)).toEqual([{ inDays: 0 }, { inDays: 7 }]);
  });
});

describe("admin-overview: currentAbsences", () => {
  const today = "2026-08-22";
  it("считает только то, что идёт прямо сейчас", () => {
    const list = [
      { dateFrom: "2026-08-20", dateTo: "2026-08-25" }, // идёт
      { dateFrom: "2026-08-22", dateTo: "2026-08-22" }, // ровно сегодня
      { dateFrom: "2026-09-01", dateTo: "2026-09-10" }, // ещё не начался
      { dateFrom: "2026-08-01", dateTo: "2026-08-10" }, // уже закончился
    ];
    expect(currentAbsences(list, today)).toEqual([
      { dateFrom: "2026-08-20", dateTo: "2026-08-25" },
      { dateFrom: "2026-08-22", dateTo: "2026-08-22" },
    ]);
  });
});
