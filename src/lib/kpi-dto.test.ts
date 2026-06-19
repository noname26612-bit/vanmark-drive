import { describe, it, expect } from "vitest";
import { actBonusSummary } from "./kpi-dto";
import type { ActBonusView } from "./kpi-dto";

// Базовый объект бонуса; в каждом тесте переопределяем нужные поля.
function ab(partial: Partial<ActBonusView>): ActBonusView {
  return {
    base: 0,
    complete: 0,
    percent: 0,
    thresholdPercent: 80,
    amount: 5000,
    awarded: false,
    value: 0,
    requiredComplete: 0,
    missing: 0,
    ...partial,
  };
}

describe("actBonusSummary — текст и тон прогресса бонуса (этап 15)", () => {
  it("нет актовых задач (база 0) → нейтрально", () => {
    const s = actBonusSummary(ab({ base: 0 }));
    expect(s.tone).toBe("neutral");
    expect(s.text).toContain("нет актовых задач");
  });

  it("начислен → зелёный, «начислен»", () => {
    const s = actBonusSummary(ab({ base: 20, complete: 17, percent: 85, awarded: true, value: 5000 }));
    expect(s.tone).toBe("green");
    expect(s.text).toContain("Акты 17/20 = 85%");
    expect(s.text).toContain("начислен");
  });

  it("не начислен (открытый месяц): склонение «акт/акта/актов» по числу", () => {
    expect(actBonusSummary(ab({ base: 20, complete: 15, percent: 75, missing: 1 })).text).toContain(
      "ещё 1 акт до",
    );
    expect(actBonusSummary(ab({ base: 25, complete: 18, percent: 72, missing: 2 })).text).toContain(
      "ещё 2 акта до",
    );
    expect(actBonusSummary(ab({ base: 30, complete: 20, percent: 67, missing: 5 })).text).toContain(
      "ещё 5 актов до",
    );
    expect(actBonusSummary(ab({ base: 30, complete: 8, percent: 27, missing: 21 })).text).toContain(
      "ещё 21 акт до",
    );
    expect(actBonusSummary(ab({ base: 25, complete: 18, percent: 72, missing: 2 })).tone).toBe("amber");
  });

  it("закрытый месяц не начислен (missing=0, база>0) → без «не хватает», нейтрально", () => {
    const s = actBonusSummary(ab({ base: 20, complete: 12, percent: 60, awarded: false, missing: 0 }));
    expect(s.tone).toBe("neutral");
    expect(s.text).toContain("не начислен");
    expect(s.text).not.toContain("ещё");
  });
});
