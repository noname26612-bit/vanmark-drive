import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_FAILURES,
  LOCKOUT_MS,
  FAILURE_WINDOW_MS,
  emptyEntry,
  evaluate,
  registerFailure,
  checkLock,
  recordFailure,
  recordSuccess,
  __resetThrottle,
} from "./login-throttle";

describe("login-throttle: чистая логика", () => {
  it("свежая запись не заблокирована", () => {
    expect(evaluate(emptyEntry(), 0)).toEqual({ locked: false });
  });

  it(`блокирует только после ${MAX_FAILURES}-й неудачи`, () => {
    const now = 1_000;
    let entry = emptyEntry();
    for (let i = 0; i < MAX_FAILURES - 1; i++) entry = registerFailure(entry, now);
    expect(evaluate(entry, now).locked).toBe(false);

    entry = registerFailure(entry, now); // десятая
    expect(evaluate(entry, now).locked).toBe(true);
  });

  it("по истечении блокировки снова доступен", () => {
    const now = 1_000;
    let entry = emptyEntry();
    for (let i = 0; i < MAX_FAILURES; i++) entry = registerFailure(entry, now);
    expect(evaluate(entry, now).locked).toBe(true);
    expect(evaluate(entry, now + LOCKOUT_MS + 1).locked).toBe(false);
  });

  it("неудачи вне окна не накапливаются в блокировку", () => {
    let entry = emptyEntry();
    for (let i = 0; i < MAX_FAILURES - 1; i++) entry = registerFailure(entry, 0);
    // последняя — далеко за окном: старые отметки отброшены, порог не достигнут
    entry = registerFailure(entry, FAILURE_WINDOW_MS + 1);
    expect(evaluate(entry, FAILURE_WINDOW_MS + 1).locked).toBe(false);
  });

  it("registerFailure не мутирует исходное состояние", () => {
    const entry = emptyEntry();
    const next = registerFailure(entry, 100);
    expect(entry.failures).toHaveLength(0);
    expect(next.failures).toHaveLength(1);
  });
});

describe("login-throttle: стор по логину", () => {
  beforeEach(() => __resetThrottle());

  it("ключ нормализуется (регистр и пробелы)", () => {
    const now = 5_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("  Artem  ", now);
    expect(checkLock("artem", now).locked).toBe(true);
    expect(checkLock("ARTEM", now).locked).toBe(true);
  });

  it("успешный вход сбрасывает счётчик", () => {
    const now = 5_000;
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure("milena", now);
    recordSuccess("milena");
    // после сброса снова почти до порога — блокировки всё ещё нет
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure("milena", now);
    expect(checkLock("milena", now).locked).toBe(false);
  });

  it("блокировка одного логина не трогает другой", () => {
    const now = 5_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("kashirskiy", now);
    expect(checkLock("kashirskiy", now).locked).toBe(true);
    expect(checkLock("pisarev", now).locked).toBe(false);
  });

  it("retryAfterMs в пределах длительности блокировки", () => {
    const now = 5_000;
    let last = recordFailure("x", now);
    for (let i = 1; i < MAX_FAILURES; i++) last = recordFailure("x", now);
    expect(last.locked).toBe(true);
    if (last.locked) {
      expect(last.retryAfterMs).toBeGreaterThan(0);
      expect(last.retryAfterMs).toBeLessThanOrEqual(LOCKOUT_MS);
    }
  });
});
