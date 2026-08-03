// Unit на время смены (03.08): сборка момента из «дата + ЧЧ:ММ» по МСК и проверки закрытия.
// Чистый модуль — без моков и БД.
import { describe, it, expect } from "vitest";
import { moscowMoment, utcDateKey, assertClosedAtValid, MAX_SHIFT_HOURS } from "./shift-time";

const HOUR = 60 * 60 * 1000;

describe("moscowMoment", () => {
  it("МСК = UTC+3: время дня переводится корректно", () => {
    expect(moscowMoment("2026-07-02", "18:30").toISOString()).toBe("2026-07-02T15:30:00.000Z");
    expect(moscowMoment("2026-07-02", "09:00").toISOString()).toBe("2026-07-02T06:00:00.000Z");
  });

  it("ночное время после полуночи попадает в предыдущий день UTC", () => {
    expect(moscowMoment("2026-07-03", "02:15").toISOString()).toBe("2026-07-02T23:15:00.000Z");
  });

  it("некорректная дата или время → validation", () => {
    expect(() => moscowMoment("02.07.2026", "18:30")).toThrowError(/ГГГГ-ММ-ДД/);
    expect(() => moscowMoment("2026-07-02", "25:00")).toThrowError(/ЧЧ:ММ/);
    expect(() => moscowMoment("2026-07-02", "")).toThrowError(/ЧЧ:ММ/);
  });
});

describe("utcDateKey", () => {
  it("дата смены → YYYY-MM-DD", () => {
    expect(utcDateKey(new Date("2026-07-02T00:00:00.000Z"))).toBe("2026-07-02");
  });
});

describe("assertClosedAtValid", () => {
  const opened = new Date("2026-07-02T06:00:00.000Z"); // 09:00 МСК

  it("нормальная смена проходит", () => {
    expect(() => assertClosedAtValid(opened, new Date(opened.getTime() + 9 * HOUR))).not.toThrow();
  });

  it("смена через полночь проходит", () => {
    // открыл 22:00 МСК, закрыл 02:15 МСК следующего дня
    const night = new Date("2026-07-02T19:00:00.000Z");
    expect(() => assertClosedAtValid(night, moscowMoment("2026-07-03", "02:15"))).not.toThrow();
  });

  it("закрытие раньше или равно открытию → validation", () => {
    expect(() => assertClosedAtValid(opened, opened)).toThrowError(/позже открытия/);
    expect(() => assertClosedAtValid(opened, new Date(opened.getTime() - HOUR))).toThrowError(
      /позже открытия/,
    );
  });

  it("ровно потолок проходит, потолок + минута — нет", () => {
    expect(() =>
      assertClosedAtValid(opened, new Date(opened.getTime() + MAX_SHIFT_HOURS * HOUR)),
    ).not.toThrow();
    expect(() =>
      assertClosedAtValid(opened, new Date(opened.getTime() + MAX_SHIFT_HOURS * HOUR + 60_000)),
    ).toThrowError(/длиннее 24 часов/);
  });

  it("опечатка в месяце (закрыть июльскую смену августом) ловится", () => {
    expect(() => assertClosedAtValid(opened, moscowMoment("2026-08-02", "18:00"))).toThrowError(
      /проверьте дату и время/,
    );
  });
});
