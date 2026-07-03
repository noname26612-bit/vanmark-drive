// Unit на закрытие смены Д/А (№2) и правку времени закрытия (№3). prisma мокируется (по образцу
// shift-service.test.ts) — тестируем доменную логику без БД: идемпотентность, аудит, привязку
// ручного времени к дню смены (МСК), обязательную причину и запрет в закрытом расчётном месяце.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { findUnique, update, payrollCount } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  payrollCount: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    shift: { findUnique, update },
    payrollStatement: { count: payrollCount },
  },
}));

import { closeShiftById, adjustShiftClosedAt } from "./shift-service";

const NOW = new Date("2026-07-02T05:30:00.000Z"); // 08:30 МСК
const ACTOR = { id: "disp-1", role: "DISPATCHER" };

function shiftRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "shift-1",
    driverId: "drv-1",
    date: new Date("2026-07-02T00:00:00.000Z"),
    status: "OPEN",
    openedAt: new Date("2026-07-02T06:00:00.000Z"), // 09:00 МСК
    openedAtReported: null,
    openedAtAdjustedAt: null,
    openedAtAdjustNote: null,
    openedOffline: false,
    confirmedAt: NOW,
    closedAt: null,
    closedById: null,
    closedAtReported: null,
    closedAtAdjustedAt: null,
    closedAtAdjustNote: null,
    driver: { name: "Алексей" },
    ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  payrollCount.mockReset();
  payrollCount.mockResolvedValue(0); // по умолчанию месяц открыт
  update.mockImplementation(({ data }) => Promise.resolve(shiftRow(data)));
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("closeShiftById — закрытие смены Д/А (№2)", () => {
  it("открытую смену закрывает: status=CLOSED, closedById=актор, closedAt=сейчас", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "OPEN" }));
    const view = await closeShiftById("shift-1", ACTOR);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("CLOSED");
    expect(data.closedById).toBe("disp-1");
    expect(data.closedAt.toISOString()).toBe(NOW.toISOString());
    expect(view.status).toBe("CLOSED");
  });

  it("уже закрытая — идемпотентно, update не зовём", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "CLOSED", closedAt: NOW }));
    const view = await closeShiftById("shift-1", ACTOR);
    expect(view.status).toBe("CLOSED");
    expect(update).not.toHaveBeenCalled();
  });

  it("ручное время + причина: closedAt по дню смены (МСК), пометка в аудит", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "OPEN" }));
    await closeShiftById("shift-1", ACTOR, { closedAtTime: "18:30", reason: "забыл закрыть" });
    const data = update.mock.calls[0][0].data;
    // 18:30 МСК 2 июля = 15:30 UTC
    expect(data.closedAt.toISOString()).toBe("2026-07-02T15:30:00.000Z");
    expect(data.closedAtAdjustNote).toBe("забыл закрыть");
    expect(data.closedAtAdjustedById).toBe("disp-1");
    expect(payrollCount).toHaveBeenCalled(); // проверили закрытость месяца
  });

  it("ручное время в закрытом месяце → отказ (periodClosed)", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "OPEN" }));
    payrollCount.mockResolvedValue(1);
    await expect(
      closeShiftById("shift-1", ACTOR, { closedAtTime: "18:30", reason: "забыл" }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(update).not.toHaveBeenCalled();
  });

  it("нет смены → 404", async () => {
    findUnique.mockResolvedValue(null);
    await expect(closeShiftById("nope", ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("adjustShiftClosedAt — правка времени закрытия (№3)", () => {
  it("закрытую смену правит: closedAt новое, снимок исходного в reported, аудит", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "CLOSED", closedAt: NOW }));
    await adjustShiftClosedAt("shift-1", { timeHHMM: "17:00", reason: "по факту позже" }, ACTOR);
    const data = update.mock.calls[0][0].data;
    expect(data.closedAt.toISOString()).toBe("2026-07-02T14:00:00.000Z"); // 17:00 МСК
    expect(data.closedAtReported.toISOString()).toBe(NOW.toISOString()); // исходное сохранено
    expect(data.closedAtAdjustNote).toBe("по факту позже");
    expect(data.closedAtAdjustedById).toBe("disp-1");
  });

  it("повторная правка не перетирает исходный reported", async () => {
    const firstReported = new Date("2026-07-02T05:00:00.000Z");
    findUnique.mockResolvedValue(
      shiftRow({ status: "CLOSED", closedAt: NOW, closedAtReported: firstReported }),
    );
    await adjustShiftClosedAt("shift-1", { timeHHMM: "19:00", reason: "ещё раз" }, ACTOR);
    expect(update.mock.calls[0][0].data.closedAtReported.toISOString()).toBe(firstReported.toISOString());
  });

  it("без причины → validation", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "CLOSED", closedAt: NOW }));
    await expect(
      adjustShiftClosedAt("shift-1", { timeHHMM: "17:00", reason: "  " }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(update).not.toHaveBeenCalled();
  });

  it("смена ещё не закрыта → validation", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "OPEN", closedAt: null }));
    await expect(
      adjustShiftClosedAt("shift-1", { timeHHMM: "17:00", reason: "правка" }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("правка в закрытом месяце → periodClosed", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "CLOSED", closedAt: NOW }));
    payrollCount.mockResolvedValue(1);
    await expect(
      adjustShiftClosedAt("shift-1", { timeHHMM: "17:00", reason: "правка" }, ACTOR),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});
