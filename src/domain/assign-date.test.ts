import { describe, it, expect } from "vitest";
import { resolveAssignedDate } from "./assign-date";

const today = new Date("2026-06-17T00:00:00.000Z");
const overdueDate = new Date("2026-06-10T00:00:00.000Z"); // прошлое → просрочена
const futureDate = new Date("2026-06-20T00:00:00.000Z"); // будущее

describe("resolveAssignedDate (авто-дата при назначении)", () => {
  it("назначение задачи БЕЗ даты → проставляем сегодня", () => {
    expect(resolveAssignedDate(null, "driver-1", today)).toEqual(today);
  });

  it("назначение ПРОСРОЧЕННОЙ задачи → переносим на сегодня (п.3, перетаскивание из «Требуют внимания»)", () => {
    expect(resolveAssignedDate(overdueDate, "driver-1", today)).toEqual(today);
  });

  it("задача с сегодняшней/будущей датой → не трогаем (null)", () => {
    expect(resolveAssignedDate(futureDate, "driver-1", today)).toBeNull();
    expect(resolveAssignedDate(today, "driver-1", today)).toBeNull();
  });

  it("снятие назначения (assigneeId=null) у задачи без даты → не датируем", () => {
    expect(resolveAssignedDate(null, null, today)).toBeNull();
  });

  it("снятие назначения у просроченной задачи → не трогаем", () => {
    expect(resolveAssignedDate(overdueDate, null, today)).toBeNull();
  });

  it("нет валидной даты сегодня (today=null) → ничего не проставляем", () => {
    expect(resolveAssignedDate(null, "driver-1", null)).toBeNull();
    expect(resolveAssignedDate(overdueDate, "driver-1", null)).toBeNull();
  });
});
