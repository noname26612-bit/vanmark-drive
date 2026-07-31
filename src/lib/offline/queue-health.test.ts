// Unit на queueStalledMinutes — баннер «очередь стоит» (инцидент 31.07: очередь могла молча не
// двигаться при живом интернете; автоконфликты запрещены, видимость — единственное лекарство).
import { describe, it, expect } from "vitest";
import { queueStalledMinutes, QUEUE_STALL_MS } from "./queue-health";
import type { QueuedAction } from "./types";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

function action(over: Partial<QueuedAction>): QueuedAction {
  return {
    id: "a1",
    seq: 1,
    kind: "transition",
    method: "POST",
    url: "/api/tasks/t/transition",
    occurredAt: new Date(NOW).toISOString(),
    taskId: "t",
    status: "pending",
    attempts: 0,
    createdAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("queueStalledMinutes", () => {
  it("пустая очередь → null", () => {
    expect(queueStalledMinutes([], NOW)).toBeNull();
  });

  it("свежие действия (моложе порога) → null", () => {
    const actions = [action({ createdAt: ago(QUEUE_STALL_MS - 60_000) })];
    expect(queueStalledMinutes(actions, NOW)).toBeNull();
  });

  it("самое старое pending старше порога → возраст в минутах", () => {
    const actions = [
      action({ id: "old", createdAt: ago(12 * 60_000) }),
      action({ id: "fresh", seq: 2, createdAt: ago(60_000) }),
    ];
    expect(queueStalledMinutes(actions, NOW)).toBe(12);
  });

  it("конфликтные не считаются: старый conflict при свежем pending → null", () => {
    const actions = [
      action({ id: "c", status: "conflict", createdAt: ago(120 * 60_000) }),
      action({ id: "p", seq: 2, createdAt: ago(60_000) }),
    ];
    expect(queueStalledMinutes(actions, NOW)).toBeNull();
  });

  it("только конфликтные → null (досылать нечего)", () => {
    const actions = [action({ status: "conflict", createdAt: ago(120 * 60_000) })];
    expect(queueStalledMinutes(actions, NOW)).toBeNull();
  });

  it("битый createdAt не роняет расчёт", () => {
    const actions = [
      action({ id: "bad", createdAt: "мусор" }),
      action({ id: "old", seq: 2, createdAt: ago(15 * 60_000) }),
    ];
    expect(queueStalledMinutes(actions, NOW)).toBe(15);
  });
});
