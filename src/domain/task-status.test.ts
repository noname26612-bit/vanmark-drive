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
  it("проходит цепочку вперёд", () => {
    expect(checkTransition(driverOwn, "ASSIGNED", "ACCEPTED").ok).toBe(true);
    expect(checkTransition(driverOwn, "ACCEPTED", "EN_ROUTE").ok).toBe(true);
    expect(checkTransition(driverOwn, "EN_ROUTE", "ON_SITE").ok).toBe(true);
    expect(checkTransition(driverOwn, "ON_SITE", "DONE").ok).toBe(true);
  });

  it("не может перепрыгнуть шаг", () => {
    expect(checkTransition(driverOwn, "ACCEPTED", "DONE")).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
    });
    expect(checkTransition(driverOwn, "ASSIGNED", "EN_ROUTE").ok).toBe(false);
  });

  it("не может отменять/переносить (это к диспетчеру)", () => {
    expect(checkTransition(driverOwn, "ACCEPTED", "CANCELLED")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(checkTransition(driverOwn, "ASSIGNED", "RESCHEDULED")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("может поставить «Ждёт», но только с причиной", () => {
    const v = checkTransition(driverOwn, "EN_ROUTE", "ON_HOLD");
    expect(v).toEqual({ ok: true, reasonRequired: true });
  });

  it("чужую задачу не двигает", () => {
    expect(checkTransition(driverOther, "ASSIGNED", "ACCEPTED")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});

describe("статусная матрица — диспетчер/админ", () => {
  it("может выполнить любой валидный переход, включая «водительские»", () => {
    expect(checkTransition(dispatcher, "NEW", "ASSIGNED").ok).toBe(true);
    expect(checkTransition(dispatcher, "ASSIGNED", "ACCEPTED").ok).toBe(true);
    expect(checkTransition(dispatcher, "EN_ROUTE", "ON_SITE").ok).toBe(true);
    expect(checkTransition(dispatcher, "ON_SITE", "DONE").ok).toBe(true);
    expect(checkTransition(admin, "ON_SITE", "DONE").ok).toBe(true);
  });

  it("может ставить «Ждёт»/«Отменена»/«Перенесена» и снимать с паузы", () => {
    expect(checkTransition(dispatcher, "ACCEPTED", "ON_HOLD")).toEqual({
      ok: true,
      reasonRequired: true,
    });
    expect(checkTransition(dispatcher, "EN_ROUTE", "CANCELLED")).toEqual({
      ok: true,
      reasonRequired: true,
    });
    expect(checkTransition(dispatcher, "ON_SITE", "RESCHEDULED").ok).toBe(true);
    expect(checkTransition(dispatcher, "ON_HOLD", "ASSIGNED").ok).toBe(true);
  });

  it("не может в обход матрицы (нет такого ребра)", () => {
    expect(checkTransition(dispatcher, "NEW", "DONE").ok).toBe(false);
    expect(checkTransition(dispatcher, "ACCEPTED", "ASSIGNED").ok).toBe(false); // назад нельзя
    expect(checkTransition(dispatcher, "DONE", "ASSIGNED").ok).toBe(false);
    expect(checkTransition(admin, "CANCELLED", "NEW").ok).toBe(false);
  });
});

describe("статусная матрица — вспомогательное", () => {
  it("reasonRequiredFor", () => {
    expect(reasonRequiredFor("ON_HOLD")).toBe(true);
    expect(reasonRequiredFor("CANCELLED")).toBe(true);
    expect(reasonRequiredFor("ACCEPTED")).toBe(false);
    expect(reasonRequiredFor("RESCHEDULED")).toBe(false);
  });

  it("isTerminal", () => {
    expect(isTerminal("DONE")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("NEW")).toBe(false);
    expect(isTerminal("ON_HOLD")).toBe(false);
  });

  it("isValidTransition отражает рёбра", () => {
    expect(isValidTransition("NEW", "ASSIGNED")).toBe(true);
    expect(isValidTransition("ON_SITE", "DONE")).toBe(true);
    expect(isValidTransition("NEW", "DONE")).toBe(false);
  });
});
