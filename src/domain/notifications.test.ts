import { describe, it, expect } from "vitest";
import {
  buildTaskPayload,
  buildMorningPayload,
  buildPassWarningPayload,
  buildActViolationsPayload,
  pluralTasks,
  validateSubscriptionInput,
} from "./notifications";

describe("pluralTasks", () => {
  it("склоняет «задача/задачи/задач»", () => {
    expect(pluralTasks(1)).toBe("задача");
    expect(pluralTasks(2)).toBe("задачи");
    expect(pluralTasks(4)).toBe("задачи");
    expect(pluralTasks(5)).toBe("задач");
    expect(pluralTasks(11)).toBe("задач");
    expect(pluralTasks(12)).toBe("задач");
    expect(pluralTasks(21)).toBe("задача");
    expect(pluralTasks(22)).toBe("задачи");
    expect(pluralTasks(0)).toBe("задач");
  });
});

describe("buildTaskPayload", () => {
  const task = { id: "t1", number: 476, title: "ЛБМ 200", type: { name: "Доставка / забор из аренды" } };

  it("назначение: заголовок, тело с типом, deeplink и tag", () => {
    const p = buildTaskPayload(task, "assigned");
    expect(p.title).toBe("Новая задача №476");
    expect(p.body).toBe("Доставка / забор из аренды: ЛБМ 200");
    expect(p.url).toBe("/m/t1");
    expect(p.tag).toBe("task-t1");
  });

  it("заголовки остальных видов", () => {
    expect(buildTaskPayload(task, "changed").title).toBe("Задача изменена №476");
    expect(buildTaskPayload(task, "rescheduled").title).toBe("Задача перенесена №476");
    expect(buildTaskPayload(task, "cancelled").title).toBe("Задача отменена №476");
  });

  it("без типа — тело без префикса", () => {
    const p = buildTaskPayload({ id: "t2", number: 1, title: "Просто", type: null }, "assigned");
    expect(p.body).toBe("Просто");
  });
});

describe("buildMorningPayload / buildPassWarningPayload", () => {
  it("утреннее напоминание с правильным склонением", () => {
    expect(buildMorningPayload(1).body).toBe("У тебя 1 задача на сегодня");
    expect(buildMorningPayload(3).body).toBe("У тебя 3 задачи на сегодня");
    expect(buildMorningPayload(7).body).toBe("У тебя 7 задач на сегодня");
    expect(buildMorningPayload(3).url).toBe("/m");
  });

  it("предупреждение о пропусках", () => {
    expect(buildPassWarningPayload(2).body).toBe("2 задачи на завтра без заказанного пропуска");
    expect(buildPassWarningPayload(2).url).toBe("/board");
  });

  it("вечерний обход актов (20:05): счёт, склонение, ведёт на /kpi", () => {
    expect(buildActViolationsPayload(1).body).toBe("1 задача без акта к 20:00 — разберите нарушения");
    expect(buildActViolationsPayload(3).body).toBe("3 задачи без акта к 20:00 — разберите нарушения");
    expect(buildActViolationsPayload(1).title).toBe("Акты не приложены");
    expect(buildActViolationsPayload(1).url).toBe("/kpi");
    expect(buildActViolationsPayload(1).tag).toBe("act-deadline");
  });
});

describe("validateSubscriptionInput", () => {
  const good = { endpoint: "https://fcm.googleapis.com/abc", keys: { p256dh: "p", auth: "a" } };

  it("нормализует валидную подписку", () => {
    expect(validateSubscriptionInput(good)).toEqual({
      endpoint: "https://fcm.googleapis.com/abc",
      p256dh: "p",
      auth: "a",
    });
  });

  it("отклоняет некорректные тела", () => {
    expect(validateSubscriptionInput(null)).toBeNull();
    expect(validateSubscriptionInput(undefined)).toBeNull();
    expect(validateSubscriptionInput({})).toBeNull();
    expect(validateSubscriptionInput({ endpoint: "https://x" })).toBeNull(); // нет keys
    expect(validateSubscriptionInput({ endpoint: "https://x", keys: { p256dh: "p" } })).toBeNull(); // нет auth
    expect(
      validateSubscriptionInput({ endpoint: "http://x", keys: { p256dh: "p", auth: "a" } }),
    ).toBeNull(); // не https
  });
});
