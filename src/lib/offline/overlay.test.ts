import { describe, it, expect } from "vitest";
import { overlayStatus, overlayShift, currentShift, hasPending, hasConflict, type ShiftLike } from "./overlay";
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

  it("конфликтный переход НЕ искажает статус (O8): виден серверный арбитр", () => {
    // Взял в работу офлайн, сервер отклонил (задачу отменили) → conflict. Список/карточка должны
    // показывать серверный CANCELLED, а не «висящий» IN_PROGRESS.
    const rejected = action({ status: "conflict", bodyJson: { toStatus: "IN_PROGRESS" } });
    expect(overlayStatus("CANCELLED", [rejected])).toBe("CANCELLED");
  });

  it("pending поверх, но конфликтный в той же пачке игнорируется", () => {
    const conflict = action({ id: "a1", seq: 1, status: "conflict", bodyJson: { toStatus: "DONE" } });
    const pending = action({ id: "a2", seq: 2, status: "pending", bodyJson: { toStatus: "IN_PROGRESS" } });
    expect(overlayStatus("ASSIGNED", [conflict, pending])).toBe("IN_PROGRESS");
  });
});

// Действие смены (O7): kind "shift", без задачи.
function shiftAction(op: "open" | "close" | "reopen", over: Partial<QueuedAction> = {}): QueuedAction {
  return action({ id: `s-${op}`, kind: "shift", url: "/api/my/shift", taskId: null, bodyJson: { op }, ...over });
}

const OPEN_SHIFT: ShiftLike = {
  status: "OPEN",
  openedAt: "2026-07-02T05:12:00.000Z",
  confirmedAt: "2026-07-02T05:20:00.000Z",
  closedAt: null,
};

describe("overlayShift (O7)", () => {
  it("нет действий → серверное состояние как есть, pendingLocal=false", () => {
    const v = overlayShift(OPEN_SHIFT, []);
    expect(v).toMatchObject({ status: "OPEN", pendingLocal: false });
  });

  it("смены нет + офлайн-открытие → «ждёт подтверждения» с временем нажатия", () => {
    const v = overlayShift(null, [shiftAction("open", { occurredAt: "2026-07-02T05:03:00.000Z" })]);
    expect(v).toMatchObject({ status: "REQUESTED", openedAt: "2026-07-02T05:03:00.000Z", pendingLocal: true });
  });

  it("офлайн-закрытие поверх открытой → CLOSED с временем нажатия", () => {
    const v = overlayShift(OPEN_SHIFT, [shiftAction("close", { occurredAt: "2026-07-02T15:00:00.000Z" })]);
    expect(v).toMatchObject({ status: "CLOSED", closedAt: "2026-07-02T15:00:00.000Z", pendingLocal: true });
  });

  it("возобновление подтверждённой → OPEN (как reopenedStatus на сервере), неподтверждённой → REQUESTED", () => {
    const closed: ShiftLike = { ...OPEN_SHIFT, status: "CLOSED", closedAt: "2026-07-02T15:00:00.000Z" };
    expect(overlayShift(closed, [shiftAction("reopen")])).toMatchObject({ status: "OPEN", closedAt: null });
    const closedUnconfirmed: ShiftLike = { ...closed, confirmedAt: null };
    expect(overlayShift(closedUnconfirmed, [shiftAction("reopen")])).toMatchObject({ status: "REQUESTED" });
  });

  it("цепочка офлайн: открыл → закрыл → возобновил (FIFO) → рабочий статус", () => {
    const v = overlayShift(null, [
      shiftAction("open", { id: "s1", seq: 1, occurredAt: "2026-07-02T05:00:00.000Z" }),
      shiftAction("close", { id: "s2", seq: 2, occurredAt: "2026-07-02T05:30:00.000Z" }),
      shiftAction("reopen", { id: "s3", seq: 3 }),
    ]);
    expect(v).toMatchObject({ status: "REQUESTED", closedAt: null, pendingLocal: true });
  });

  it("конфликтные действия смены не применяются; чужие kind игнорируются", () => {
    const v = overlayShift(OPEN_SHIFT, [
      shiftAction("close", { status: "conflict" }),
      action({ kind: "transition", bodyJson: { toStatus: "DONE" } }),
    ]);
    expect(v).toMatchObject({ status: "OPEN", pendingLocal: false });
  });

  it("смены нет и действий нет → null (блок покажет «Смена не открыта»)", () => {
    expect(overlayShift(null, [])).toBeNull();
  });
});

describe("currentShift — нормализация кэша по дню (наутро офлайн, O7)", () => {
  const base = { ...OPEN_SHIFT, date: "2026-07-01" };

  it("вчерашняя ЗАКРЫТАЯ смена → null (сегодня «не открыта», можно открывать заново)", () => {
    const closed = { ...base, status: "CLOSED" as const, closedAt: "2026-07-01T15:00:00.000Z" };
    expect(currentShift(closed, "2026-07-02")).toBeNull();
  });

  it("вчерашняя НЕзакрытая → как есть (её реально можно закрыть/продолжить)", () => {
    expect(currentShift(base, "2026-07-02")).toBe(base);
  });

  it("сегодняшняя закрытая → как есть (обычное «Возобновить смену»)", () => {
    const closed = { ...base, date: "2026-07-02", status: "CLOSED" as const };
    expect(currentShift(closed, "2026-07-02")).toBe(closed);
  });

  it("null → null; офлайн-открытие поверх даёт REQUESTED (сквозной сценарий утра)", () => {
    const v = overlayShift(currentShift(null, "2026-07-02"), [
      shiftAction("open", { occurredAt: "2026-07-02T05:03:00.000Z" }),
    ]);
    expect(v).toMatchObject({ status: "REQUESTED", pendingLocal: true });
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
