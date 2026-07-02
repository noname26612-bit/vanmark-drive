import { describe, it, expect } from "vitest";
import {
  checkTransition,
  isValidTransition,
  reasonRequiredFor,
  isTerminal,
  type TransitionActor,
} from "./task-status";

const dispatcher: TransitionActor = { role: "DISPATCHER", isAssignee: false };
const admin: TransitionActor = { role: "ADMIN", isAssignee: false };
const driverOwn: TransitionActor = { role: "DRIVER", isAssignee: true };
const driverOther: TransitionActor = { role: "DRIVER", isAssignee: false };

describe("статусная матрица — водитель (назначенный)", () => {
  it("проходит схлопнутую цепочку: взял в работу → завершил", () => {
    expect(checkTransition(driverOwn, "ASSIGNED", "IN_PROGRESS").ok).toBe(true);
    expect(checkTransition(driverOwn, "IN_PROGRESS", "DONE").ok).toBe(true);
  });

  it("возобновляет задачу из паузы", () => {
    expect(checkTransition(driverOwn, "ON_HOLD", "IN_PROGRESS").ok).toBe(true);
  });

  it("не может завершить, не взяв в работу", () => {
    expect(checkTransition(driverOwn, "ASSIGNED", "DONE")).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
    });
    // NEW водителю не принадлежит и ребра NEW→IN_PROGRESS нет
    expect(checkTransition(driverOwn, "NEW", "IN_PROGRESS").ok).toBe(false);
  });

  it("не может отменять/переносить (это к диспетчеру)", () => {
    expect(checkTransition(driverOwn, "IN_PROGRESS", "CANCELLED")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(checkTransition(driverOwn, "ASSIGNED", "RESCHEDULED")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("может поставить «На паузе» без обязательной причины", () => {
    const v = checkTransition(driverOwn, "IN_PROGRESS", "ON_HOLD");
    expect(v).toEqual({ ok: true, reasonRequired: false });
  });

  it("чужую задачу не двигает", () => {
    expect(checkTransition(driverOther, "ASSIGNED", "IN_PROGRESS")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});

describe("статусная матрица — диспетчер/админ", () => {
  it("может выполнить любой валидный переход, включая «водительские»", () => {
    expect(checkTransition(dispatcher, "NEW", "ASSIGNED").ok).toBe(true);
    expect(checkTransition(dispatcher, "ASSIGNED", "IN_PROGRESS").ok).toBe(true);
    expect(checkTransition(dispatcher, "IN_PROGRESS", "DONE").ok).toBe(true);
    expect(checkTransition(admin, "IN_PROGRESS", "DONE").ok).toBe(true);
  });

  it("может ставить «На паузе»/«Отменена»/«Перенесена» и снимать с паузы", () => {
    expect(checkTransition(dispatcher, "IN_PROGRESS", "ON_HOLD")).toEqual({
      ok: true,
      reasonRequired: false, // пауза — причина по желанию (решение Артёма 02.07.2026)
    });
    expect(checkTransition(dispatcher, "IN_PROGRESS", "CANCELLED")).toEqual({
      ok: true,
      reasonRequired: true, // отмена — причина обязательна
    });
    expect(checkTransition(dispatcher, "IN_PROGRESS", "RESCHEDULED").ok).toBe(true);
    expect(checkTransition(dispatcher, "ON_HOLD", "ASSIGNED").ok).toBe(true);
  });

  it("не может в обход матрицы (нет такого ребра)", () => {
    expect(checkTransition(dispatcher, "NEW", "DONE").ok).toBe(false);
    expect(checkTransition(dispatcher, "IN_PROGRESS", "ASSIGNED").ok).toBe(false); // назад нельзя
    expect(checkTransition(dispatcher, "DONE", "ASSIGNED").ok).toBe(false);
    expect(checkTransition(admin, "CANCELLED", "NEW").ok).toBe(false);
  });
});

describe("статусная матрица — legacy-статусы тупиковые", () => {
  it("ACCEPTED/EN_ROUTE/ON_SITE больше не имеют рёбер (только история)", () => {
    expect(isValidTransition("ACCEPTED", "EN_ROUTE")).toBe(false);
    expect(isValidTransition("EN_ROUTE", "ON_SITE")).toBe(false);
    expect(isValidTransition("ON_SITE", "DONE")).toBe(false);
    expect(checkTransition(dispatcher, "ON_SITE", "DONE").ok).toBe(false);
    expect(isTerminal("ON_SITE")).toBe(true); // нет исходящих рёбер
  });
});

describe("статусная матрица — вспомогательное", () => {
  it("reasonRequiredFor — обязательна только у отмены (пауза — по желанию)", () => {
    expect(reasonRequiredFor("ON_HOLD")).toBe(false);
    expect(reasonRequiredFor("CANCELLED")).toBe(true);
    expect(reasonRequiredFor("IN_PROGRESS")).toBe(false);
    expect(reasonRequiredFor("RESCHEDULED")).toBe(false);
  });

  it("isTerminal", () => {
    expect(isTerminal("DONE")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("NEW")).toBe(false);
    expect(isTerminal("ON_HOLD")).toBe(false);
    expect(isTerminal("IN_PROGRESS")).toBe(false);
  });

  it("isValidTransition отражает рёбра", () => {
    expect(isValidTransition("NEW", "ASSIGNED")).toBe(true);
    expect(isValidTransition("IN_PROGRESS", "DONE")).toBe(true);
    expect(isValidTransition("NEW", "DONE")).toBe(false);
  });
});
