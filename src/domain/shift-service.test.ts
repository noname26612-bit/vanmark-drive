// Unit на офлайн-смену (O7): открытие/закрытие/переоткрытие с клиентским временем нажатия.
// prisma мокируется (по образцу idempotency.test.ts) — тестируем доменную логику без БД:
// день смены от достоверного момента (clamp), детект «открыта офлайн», идемпотентность повторов,
// фолбэк закрытия «за полночь», мягкая ошибка вместо тупика очереди.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { findUnique, findFirst, create, update } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { shift: { findUnique, findFirst, create, update } },
}));

import { openShift, closeShift, reopenShift } from "./shift-service";

// Фиксированное «сейчас»: 08:30 МСК 2 июля (05:30 UTC) — до полуночи далеко, день однозначен.
const NOW = new Date("2026-07-02T05:30:00.000Z");

// Строка смены, как её вернула бы БД (минимум полей, который читает toView).
function shiftRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "shift-1",
    driverId: "drv-1",
    date: new Date("2026-07-02T00:00:00.000Z"),
    status: "REQUESTED",
    openedAt: NOW,
    openedAtReported: null,
    openedAtAdjustedAt: null,
    openedAtAdjustNote: null,
    openedOffline: false,
    confirmedAt: null,
    closedAt: null,
    ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
  create.mockReset();
  update.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openShift — открытие с временем нажатия (O7)", () => {
  it("онлайн (occurredAt ≈ сейчас) → openedAt = момент нажатия, openedOffline=false", async () => {
    findUnique.mockResolvedValue(null);
    const at = new Date(NOW.getTime() - 3_000).toISOString(); // 3 с назад — обычная сетевая задержка
    create.mockImplementation(({ data }) => Promise.resolve(shiftRow(data)));
    await openShift("drv-1", at);
    const data = create.mock.calls[0][0].data;
    expect(data.openedAt.toISOString()).toBe(at);
    expect(data.openedOffline).toBe(false);
    expect(data.date.toISOString().slice(0, 10)).toBe("2026-07-02");
  });

  it("досылка из офлайн-очереди (нажатие 2 часа назад) → openedAt = время нажатия, openedOffline=true", async () => {
    findUnique.mockResolvedValue(null);
    const at = new Date(NOW.getTime() - 2 * 3600_000).toISOString();
    create.mockImplementation(({ data }) => Promise.resolve(shiftRow(data)));
    const view = await openShift("drv-1", at);
    const data = create.mock.calls[0][0].data;
    expect(data.openedAt.toISOString()).toBe(at);
    expect(data.openedOffline).toBe(true);
    expect(view.openedOffline).toBe(true);
  });

  it("день смены — от момента НАЖАТИЯ в МСК: нажал 23:50 МСК 1 июля, дослал утром 2-го → смена за 1 июля", async () => {
    findUnique.mockResolvedValue(null);
    const at = "2026-07-01T20:50:00.000Z"; // 23:50 МСК 1 июля
    create.mockImplementation(({ data }) => Promise.resolve(shiftRow(data)));
    await openShift("drv-1", at);
    expect(create.mock.calls[0][0].data.date.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("клиентское время вне окна доверия (3 дня назад) → игнорируем, берём серверное «сейчас»", async () => {
    findUnique.mockResolvedValue(null);
    const at = new Date(NOW.getTime() - 72 * 3600_000).toISOString();
    create.mockImplementation(({ data }) => Promise.resolve(shiftRow(data)));
    await openShift("drv-1", at);
    const data = create.mock.calls[0][0].data;
    expect(data.openedAt.toISOString()).toBe(NOW.toISOString());
    expect(data.openedOffline).toBe(false);
  });

  it("повторное открытие того дня (в т.ч. досылка после вмешательства Милены) → существующая смена, без пересоздания", async () => {
    const existing = shiftRow({ status: "OPEN", confirmedAt: NOW });
    findUnique.mockResolvedValue(existing);
    const view = await openShift("drv-1", new Date(NOW.getTime() - 3600_000).toISOString());
    expect(view.id).toBe("shift-1");
    expect(view.status).toBe("OPEN");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("closeShift — закрытие с временем нажатия (O7)", () => {
  it("смена дня нажатия есть → closedAt = момент нажатия", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "OPEN" }));
    const at = new Date(NOW.getTime() - 40 * 60_000).toISOString(); // закрыл 40 мин назад без связи
    update.mockImplementation(({ data }) => Promise.resolve(shiftRow({ ...data })));
    await closeShift("drv-1", at);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("CLOSED");
    expect(data.closedAt.toISOString()).toBe(at);
  });

  it("повторное закрытие (досылка дубля) → идемпотентно, update не зовём", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "CLOSED", closedAt: NOW }));
    const view = await closeShift("drv-1", NOW.toISOString());
    expect(view.status).toBe("CLOSED");
    expect(update).not.toHaveBeenCalled();
  });

  it("на день нажатия смены нет → закрываем последнюю незакрытую (досылка уехала за полночь)", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(shiftRow({ status: "OPEN", date: new Date("2026-07-01T00:00:00.000Z") }));
    update.mockImplementation(({ data }) => Promise.resolve(shiftRow({ ...data })));
    await closeShift("drv-1", NOW.toISOString());
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { driverId: "drv-1", status: { in: ["REQUESTED", "OPEN"] } } }),
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("смен нет вовсе → мягкая доменная ошибка (не тупик очереди), с человеческим текстом", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    await expect(closeShift("drv-1", NOW.toISOString())).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("откройте смену"),
    });
  });
});

describe("reopenShift — возобновление (O7)", () => {
  it("закрытая смена дня → снова REQUESTED (не была подтверждена), closedAt снят", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "CLOSED", closedAt: NOW }));
    update.mockImplementation(({ data }) => Promise.resolve(shiftRow({ ...data, closedAt: null })));
    const view = await reopenShift("drv-1", NOW.toISOString());
    expect(update.mock.calls[0][0].data).toMatchObject({ status: "REQUESTED", closedAt: null });
    expect(view.closedAt).toBeNull();
  });

  it("подтверждённая закрытая → снова OPEN (подтверждение не теряем)", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "CLOSED", closedAt: NOW, confirmedAt: NOW }));
    update.mockImplementation(({ data }) => Promise.resolve(shiftRow({ ...data, confirmedAt: NOW })));
    await reopenShift("drv-1", NOW.toISOString());
    expect(update.mock.calls[0][0].data.status).toBe("OPEN");
  });

  it("не закрыта → идемпотентно, как есть", async () => {
    findUnique.mockResolvedValue(shiftRow({ status: "OPEN" }));
    const view = await reopenShift("drv-1", NOW.toISOString());
    expect(view.status).toBe("OPEN");
    expect(update).not.toHaveBeenCalled();
  });
});
