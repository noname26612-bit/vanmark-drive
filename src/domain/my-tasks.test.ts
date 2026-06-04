import { describe, it, expect } from "vitest";
import { myTasksWhere } from "./my-tasks";

const ME = "driver-a-id";
const OTHER = "driver-b-id";
const TODAY = new Date("2026-06-04T00:00:00.000Z");

describe("myTasksWhere — изоляция водителя (ARCHITECTURE §6)", () => {
  it("today: всегда фильтрует строго по своему assigneeId", () => {
    const w = myTasksWhere(ME, TODAY, "today");
    expect(w.assigneeId).toBe(ME);
    expect(w.assigneeId).not.toBe(OTHER);
  });

  it("upcoming: всегда фильтрует строго по своему assigneeId", () => {
    const w = myTasksWhere(ME, TODAY, "upcoming");
    expect(w.assigneeId).toBe(ME);
  });

  it("в where нет ни одного пути без привязки к assigneeId", () => {
    for (const scope of ["today", "upcoming"] as const) {
      const w = myTasksWhere(ME, TODAY, scope);
      // assigneeId — поле верхнего уровня (AND по умолчанию), а не внутри OR,
      // поэтому ни одна ветка OR не может «вытащить» чужую задачу.
      expect(Object.prototype.hasOwnProperty.call(w, "assigneeId")).toBe(true);
      expect(w.assigneeId).toBe(ME);
    }
  });
});

describe("myTasksWhere — наполнение вкладок", () => {
  it("today: сегодняшние + просроченные открытые + без даты открытые", () => {
    const w = myTasksWhere(ME, TODAY, "today");
    expect(w.OR).toEqual([
      { scheduledDate: TODAY },
      { scheduledDate: { lt: TODAY }, status: { notIn: ["DONE", "CANCELLED"] } },
      { scheduledDate: null, status: { notIn: ["DONE", "CANCELLED"] } },
    ]);
    // в «Сегодня» нет верхнеуровневого ограничения по дате — оно внутри OR
    expect(w.scheduledDate).toBeUndefined();
  });

  it("upcoming: только будущее (дата > сегодня), без отменённых", () => {
    const w = myTasksWhere(ME, TODAY, "upcoming");
    expect(w.scheduledDate).toEqual({ gt: TODAY });
    expect(w.status).toEqual({ not: "CANCELLED" });
    expect(w.OR).toBeUndefined();
  });
});
