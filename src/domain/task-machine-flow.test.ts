import { describe, it, expect } from "vitest";
import {
  MACHINE_FLOWS,
  MACHINE_FLOW_HINT,
  MACHINE_FLOW_LABEL,
  TASK_MACHINE_DIRECTION_LABEL,
  flowEffect,
  flowTouchesStatus,
  forcedDirection,
  isBidirectionalFlow,
  normalizeDirection,
  presetDirection,
} from "./task-machine-flow";
import { MACHINE_STATUSES } from "./machine-status";
import type { MachineFlow, MachineStatus, TaskMachineDirection } from "@/generated/prisma/enums";

const DIRECTIONS: TaskMachineDirection[] = ["OUT", "IN"];

// Таблица автоматики из плана 21.08.2026 — здесь она в исполняемом виде. Если правило меняется,
// эта таблица меняется вместе с кодом, и расхождение видно сразу.
describe("task-machine-flow: таблица автоматики", () => {
  it("продажа с доставкой: станок продан, направление не спрашивается", () => {
    expect(flowEffect("SOLD_DELIVERY", "OUT")).toEqual({ kind: "status", status: "SOLD" });
    // Даже если в теле запроса пришло «забираем» — тип решает сам (forcedDirection).
    expect(flowEffect("SOLD_DELIVERY", "IN")).toEqual({ kind: "status", status: "SOLD" });
  });

  it("аренда: везём → «В аренде», забираем → «Готов»", () => {
    expect(flowEffect("RENTAL", "OUT")).toEqual({ kind: "status", status: "RENTED" });
    expect(flowEffect("RENTAL", "IN")).toEqual({ kind: "status", status: "READY" });
  });

  it("ремонт: везём → «Выдан клиенту», забираем → «Требует ремонта»", () => {
    expect(flowEffect("REPAIR_RETURN", "OUT")).toEqual({ kind: "status", status: "RELEASED" });
    expect(flowEffect("REPAIR_RETURN", "IN")).toEqual({ kind: "status", status: "NEEDS_REPAIR" });
  });

  it("закупка: отмечаем поступление, состояние не трогаем", () => {
    expect(flowEffect("PURCHASE", "IN")).toEqual({ kind: "arrival" });
    expect(flowEffect("PURCHASE", "OUT")).toEqual({ kind: "arrival" }); // направление жёсткое
  });

  it("транспортная компания: отправка — «Продан» только у станка на продажу, получение — как закупка", () => {
    expect(flowEffect("CARRIER", "OUT")).toEqual({ kind: "soldIfOnSale" });
    expect(flowEffect("CARRIER", "IN")).toEqual({ kind: "arrival" });
  });

  it("без правила ничего не происходит ни в одну сторону", () => {
    for (const d of DIRECTIONS) expect(flowEffect("NONE", d)).toEqual({ kind: "none" });
  });

  it("у каждой пары «правило × направление» есть эффект — дыр в таблице нет", () => {
    const pairs: [MachineFlow, TaskMachineDirection][] = [];
    for (const f of MACHINE_FLOWS) for (const d of DIRECTIONS) pairs.push([f, d]);
    expect(pairs).toHaveLength(12);
    for (const [f, d] of pairs) expect(flowEffect(f, d).kind).toBeTruthy();
  });

  it("состояния из таблицы существуют и не выведены из оборота", () => {
    for (const f of MACHINE_FLOWS) {
      for (const d of DIRECTIONS) {
        const e = flowEffect(f, d);
        if (e.kind !== "status") continue;
        expect(MACHINE_STATUSES).toContain(e.status);
        expect(e.status).not.toBe("ACCEPTED"); // выведен из оборота 20.08.2026
        expect(e.status).not.toBe("VOIDED"); // аннулирование — только руками, с причиной
      }
    }
  });
});

describe("task-machine-flow: направление", () => {
  it("жёсткое направление только у однонаправленных типов", () => {
    expect(forcedDirection("SOLD_DELIVERY")).toBe("OUT");
    expect(forcedDirection("PURCHASE")).toBe("IN");
    expect(forcedDirection("RENTAL")).toBeNull();
    expect(forcedDirection("REPAIR_RETURN")).toBeNull();
    expect(forcedDirection("CARRIER")).toBeNull();
    expect(forcedDirection("NONE")).toBeNull();
  });

  it("сегмент направления показывается ровно у трёх правил", () => {
    expect(MACHINE_FLOWS.filter(isBidirectionalFlow)).toEqual([
      "RENTAL",
      "REPAIR_RETURN",
      "CARRIER",
    ]);
  });

  it("двунаправленность и жёсткое направление — взаимоисключающие", () => {
    for (const f of MACHINE_FLOWS) {
      if (isBidirectionalFlow(f)) expect(forcedDirection(f)).toBeNull();
      if (forcedDirection(f) !== null) expect(isBidirectionalFlow(f)).toBe(false);
    }
  });

  it("нормализация: жёсткое правило перекрывает выбор человека, свободное — уважает", () => {
    expect(normalizeDirection("SOLD_DELIVERY", "IN")).toBe("OUT");
    expect(normalizeDirection("PURCHASE", "OUT")).toBe("IN");
    expect(normalizeDirection("RENTAL", "IN")).toBe("IN");
    expect(normalizeDirection("RENTAL", "OUT")).toBe("OUT");
    expect(normalizeDirection("NONE", "IN")).toBe("IN");
  });

  it("предвыбор: станок у клиента — забираем, станок на площадке — везём", () => {
    expect(presetDirection("RENTED")).toBe("IN");
    expect(presetDirection("RELEASED")).toBe("IN");
    expect(presetDirection("SOLD")).toBe("IN");
    expect(presetDirection("READY")).toBe("OUT");
    expect(presetDirection("NEEDS_REPAIR")).toBe("OUT");
    expect(presetDirection("IN_REPAIR")).toBe("OUT");
  });

  it("предвыбор определён для каждого состояния станка", () => {
    for (const s of MACHINE_STATUSES) {
      expect(DIRECTIONS).toContain(presetDirection(s as MachineStatus));
    }
  });
});

describe("task-machine-flow: подписи", () => {
  it("у каждого правила есть подпись и пояснение", () => {
    for (const f of MACHINE_FLOWS) {
      expect(MACHINE_FLOW_LABEL[f]?.length).toBeGreaterThan(0);
      expect(MACHINE_FLOW_HINT[f]?.length).toBeGreaterThan(0);
    }
  });

  it("направления подписаны словами Артёма", () => {
    expect(TASK_MACHINE_DIRECTION_LABEL.OUT).toBe("Везём клиенту");
    expect(TASK_MACHINE_DIRECTION_LABEL.IN).toBe("Забираем к нам");
  });

  it("«трогает ли состояние» совпадает с таблицей — подпись «автоматика: —» не врёт", () => {
    for (const f of MACHINE_FLOWS) {
      const touches = DIRECTIONS.some((d) => {
        const e = flowEffect(f, d);
        return e.kind === "status" || e.kind === "soldIfOnSale";
      });
      expect(flowTouchesStatus(f)).toBe(touches);
    }
  });
});
