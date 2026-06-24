import { describe, it, expect } from "vitest";
import { overlayStatus, hasPending, hasConflict } from "./overlay";
import type { QueuedAction } from "./types";

function action(over: Partial<QueuedAction>): QueuedAction {
  return {
    id: "a",
    seq: 1,
    kind: "transition",
    method: "POST",
    url: "/api/tasks/t/transition",
    occurredAt: "2026-06-23T10:00:00.000Z",
    taskId: "t",
    status: "pending",
    attempts: 0,
    createdAt: "2026-06-23T10:00:00.000Z",
    ...over,
  };
}

describe("overlayStatus", () => {
  it("нет действий → серверный статус без изменений", () => {
    expect(overlayStatus("ASSIGNED", [])).toBe("ASSIGNED");
  });

  it("один переход в очереди перекрывает статус", () => {
    const a = action({ bodyJson: { toStatus: "IN_PROGRESS" } });
    expect(overlayStatus("ASSIGNED", [a])).toBe("IN_PROGRESS");
  });

  it("несколько переходов → побеждает последний (по порядку)", () => {
    const a1 = action({ id: "a1", seq: 1, bodyJson: { toStatus: "IN_PROGRESS" } });
    const a2 = action({ id: "a2", seq: 2, bodyJson: { toStatus: "DONE" } });
    expect(overlayStatus("ASSIGNED", [a1, a2])).toBe("DONE");
  });

  it("не-transition действия не влияют на статус", () => {
    const c = action({ kind: "comment", bodyJson: { text: "привет" } });
    expect(overlayStatus("IN_PROGRESS", [c])).toBe("IN_PROGRESS");
  });
});

describe("hasPending / hasConflict", () => {
  it("pending/syncing → есть ожидающие", () => {
    expect(hasPending([action({ status: "pending" })])).toBe(true);
    expect(hasPending([action({ status: "syncing" })])).toBe(true);
    expect(hasPending([action({ status: "conflict" })])).toBe(false);
  });

  it("conflict помечается отдельно", () => {
    expect(hasConflict([action({ status: "conflict" })])).toBe(true);
    expect(hasConflict([action({ status: "pending" })])).toBe(false);
  });
});
