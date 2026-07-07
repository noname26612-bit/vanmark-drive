import { describe, it, expect } from "vitest";
import { addDaysISO, STATUS_BADGE, STATUS_BAR, PASS_BADGE, STATUS_LABEL, isStatusBadgeHidden } from "./task-ui";

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

describe("палитра статусов (спокойная, редизайн 18.06)", () => {
  const statuses = Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[];
  const neutral = ["NEW", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ON_SITE", "RESCHEDULED"] as const;

  it("каждый статус покрыт во всех картах", () => {
    for (const s of statuses) {
      expect(STATUS_BADGE[s]).toBeTruthy();
      expect(STATUS_BAR[s]).toBeTruthy();
    }
  });

  it("метки контурные — без заливок и таблеток (border, не bg-/rounded-full)", () => {
    // «В работе» — намеренное исключение: синяя заливка (усилена 07.07, Артём).
    for (const s of statuses) {
      if (s === "IN_PROGRESS") continue;
      expect(STATUS_BADGE[s]).toContain("border");
      expect(STATUS_BADGE[s]).not.toContain("bg-");
    }
  });

  it("«В работе» — насыщенная синяя заливка (исключение, усилено Артём 07.07)", () => {
    expect(STATUS_BADGE.IN_PROGRESS).toContain("bg-blue-600");
    expect(STATUS_BADGE.IN_PROGRESS).toContain("text-white");
  });

  it("«Назначена» — метку не показываем; значимые статусы показываем", () => {
    expect(isStatusBadgeHidden("ASSIGNED")).toBe(true);
    expect(isStatusBadgeHidden("NEW")).toBe(false);
    expect(isStatusBadgeHidden("IN_PROGRESS")).toBe(false);
    expect(isStatusBadgeHidden("DONE")).toBe(false);
    expect(isStatusBadgeHidden("ON_HOLD")).toBe(false);
  });

  it("цвет = смысл: зелёный=готово, красный=сорвано, янтарь=внимание", () => {
    expect(STATUS_BAR.DONE).toContain("green");
    expect(STATUS_BADGE.DONE).toContain("green");
    expect(STATUS_BAR.CANCELLED).toContain("red");
    expect(STATUS_BADGE.CANCELLED).toContain("red");
    expect(STATUS_BAR.ON_HOLD).toContain("amber");
    expect(STATUS_BADGE.ON_HOLD).toContain("amber");
  });

  it("нейтральные статусы — графит без «радужных» цветов", () => {
    for (const s of neutral) {
      expect(STATUS_BADGE[s]).toContain("slate");
      expect(STATUS_BADGE[s]).not.toMatch(/green|red|amber|blue|violet|indigo|orange|sky/);
      expect(STATUS_BAR[s]).not.toMatch(/violet|indigo|blue|orange|sky/);
    }
  });

  it("переименование статусов (этап A): «В работе» / «Завершена» / «На паузе»", () => {
    expect(STATUS_LABEL.IN_PROGRESS).toBe("В работе");
    expect(STATUS_LABEL.DONE).toBe("Завершена");
    expect(STATUS_LABEL.ON_HOLD).toBe("На паузе");
  });

  it("пропуск: нужен — янтарный сигнал, заказан — спокойный графит, оба контурные", () => {
    expect(PASS_BADGE.NEEDED).toContain("amber");
    expect(PASS_BADGE.NEEDED).toContain("border");
    // «Заказан» больше не зелёный — вопрос закрыт, подсвечивать нечего.
    expect(PASS_BADGE.ORDERED).toContain("slate");
    expect(PASS_BADGE.ORDERED).not.toMatch(/green|amber|red/);
    expect(PASS_BADGE.ORDERED).toContain("border");
  });
});
