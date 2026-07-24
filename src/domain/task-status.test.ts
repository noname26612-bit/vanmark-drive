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

  // Напарник (20.07.2026): isAssignee строго по assigneeId → напарник для матрицы «не исполнитель».
  // Регресс-тест фиксирует, что пара НЕ открыла напарнику переходы (матрица не менялась).
  it("напарник (isAssignee=false) не двигает статусы парной задачи", () => {
    expect(checkTransition(driverOther, "ASSIGNED", "IN_PROGRESS").ok).toBe(false);
    expect(checkTransition(driverOther, "IN_PROGRESS", "DONE").ok).toBe(false);
    expect(checkTransition(driverOther, "IN_PROGRESS", "ON_HOLD").ok).toBe(false);
  });

  // Свободная смена статуса — только диспетчер/директор; водителю откат недоступен (24.07.2026).
  it("водитель НЕ откатывает завершённую/отменённую (терминальные рёбер не имеют)", () => {
    expect(checkTransition(driverOwn, "DONE", "IN_PROGRESS").ok).toBe(false);
    expect(checkTransition(driverOwn, "DONE", "ASSIGNED").ok).toBe(false);
    expect(checkTransition(driverOwn, "CANCELLED", "ASSIGNED").ok).toBe(false);
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

  // Свободная смена статуса (решение Артёма 24.07.2026, кейс №700): диспетчер/директор вручную
  // выставляет любой актуальный статус — в т.ч. «назад» и откат из терминального.
  it("свободно меняет статус вручную, включая откат из терминального", () => {
    expect(checkTransition(dispatcher, "NEW", "DONE").ok).toBe(true);
    expect(checkTransition(dispatcher, "IN_PROGRESS", "ASSIGNED").ok).toBe(true); // назад — можно
    expect(checkTransition(dispatcher, "DONE", "ASSIGNED").ok).toBe(true);
    expect(checkTransition(dispatcher, "DONE", "IN_PROGRESS").ok).toBe(true);
    expect(checkTransition(dispatcher, "DONE", "CANCELLED").ok).toBe(true); // кейс №700
    expect(checkTransition(admin, "CANCELLED", "NEW").ok).toBe(true);
    expect(checkTransition(admin, "CANCELLED", "ASSIGNED").ok).toBe(true);
  });

  it("при откате из терминального требует причину (аудит)", () => {
    expect(checkTransition(dispatcher, "DONE", "ASSIGNED")).toEqual({ ok: true, reasonRequired: true });
    expect(checkTransition(dispatcher, "DONE", "IN_PROGRESS")).toEqual({ ok: true, reasonRequired: true });
    expect(checkTransition(dispatcher, "CANCELLED", "NEW")).toEqual({ ok: true, reasonRequired: true });
  });

  it("вручную нельзя ставить legacy/транзитные статусы (не в MANUAL_STATUSES)", () => {
    expect(checkTransition(dispatcher, "DONE", "ON_SITE").ok).toBe(false); // to legacy
    expect(checkTransition(dispatcher, "ON_SITE", "DONE").ok).toBe(false); // from legacy
    expect(checkTransition(dispatcher, "DONE", "RESCHEDULED").ok).toBe(false); // RESCHEDULED — транзитный
    expect(checkTransition(dispatcher, "DONE", "DONE").ok).toBe(false); // пустой переход
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
  it("reasonRequiredFor — обязательна у отмены и при откате из терминального (пауза — по желанию)", () => {
    expect(reasonRequiredFor("ON_HOLD")).toBe(false);
    expect(reasonRequiredFor("CANCELLED")).toBe(true);
    expect(reasonRequiredFor("IN_PROGRESS")).toBe(false);
    expect(reasonRequiredFor("RESCHEDULED")).toBe(false);
    // Откат из завершённой/отменённой (from) — причина обязательна для аудита.
    expect(reasonRequiredFor("ASSIGNED", "DONE")).toBe(true);
    expect(reasonRequiredFor("IN_PROGRESS", "DONE")).toBe(true);
    expect(reasonRequiredFor("NEW", "CANCELLED")).toBe(true);
    expect(reasonRequiredFor("ASSIGNED", "IN_PROGRESS")).toBe(false); // обычная смена — без причины
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
