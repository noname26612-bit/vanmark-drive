import { describe, it, expect } from "vitest";
import { resolveCompletionDate, formatDayRu } from "./completion-date";

// scheduledDate хранится UTC-полночью (@db.Date), день завершения считается по МСК (KPI_TZ).
const plannedJul10 = new Date("2026-07-10T00:00:00.000Z");

describe("resolveCompletionDate (заявка числится днём фактического завершения)", () => {
  it("закрыта на следующий день → переносим на день завершения (кейс №639)", () => {
    // План 10.07, завершена 11.07 в 12:36 МСК (09:36 UTC).
    const completedAt = new Date("2026-07-11T09:36:00.000Z");
    expect(resolveCompletionDate(plannedJul10, completedAt)).toEqual(
      new Date("2026-07-11T00:00:00.000Z"),
    );
  });

  it("закрыта в свой плановый день → не трогаем (null)", () => {
    const completedAt = new Date("2026-07-10T14:00:00.000Z"); // 17:00 МСК того же дня
    expect(resolveCompletionDate(plannedJul10, completedAt)).toBeNull();
  });

  it("день считается по МСК: 22:30 UTC = 01:30 МСК следующего дня", () => {
    // 10.07 22:30 UTC — по Москве уже 11.07, заявка должна уехать на 11-е.
    const completedAt = new Date("2026-07-10T22:30:00.000Z");
    expect(resolveCompletionDate(plannedJul10, completedAt)).toEqual(
      new Date("2026-07-11T00:00:00.000Z"),
    );
  });

  it("ранняя ночь МСК: 21:05 UTC 09.07 = 00:05 МСК 10.07 → плановый день, не трогаем", () => {
    const completedAt = new Date("2026-07-09T21:05:00.000Z");
    expect(resolveCompletionDate(plannedJul10, completedAt)).toBeNull();
  });

  it("задача «Без даты» → получает день завершения", () => {
    const completedAt = new Date("2026-07-11T09:00:00.000Z");
    expect(resolveCompletionDate(null, completedAt)).toEqual(
      new Date("2026-07-11T00:00:00.000Z"),
    );
  });

  it("закрыта досрочно (раньше плана) → тоже день фактического завершения", () => {
    const completedAt = new Date("2026-07-09T10:00:00.000Z"); // 13:00 МСК 09.07
    expect(resolveCompletionDate(plannedJul10, completedAt)).toEqual(
      new Date("2026-07-09T00:00:00.000Z"),
    );
  });

  it("офлайн-досылка: момент действия в прошлом → день момента действия, не досылки", () => {
    // Водитель нажал «Завершена» офлайн 11.07 (occurredAt), досылка ушла позже — день от occurredAt.
    const occurredAt = new Date("2026-07-11T15:20:00.000Z");
    expect(resolveCompletionDate(plannedJul10, occurredAt)).toEqual(
      new Date("2026-07-11T00:00:00.000Z"),
    );
  });
});

describe("formatDayRu (дата для текста события журнала)", () => {
  it("UTC-полночь → ДД.ММ.ГГГГ", () => {
    expect(formatDayRu(plannedJul10)).toBe("10.07.2026");
  });

  it("null → null (заявка была «Без даты»)", () => {
    expect(formatDayRu(null)).toBeNull();
  });
});
