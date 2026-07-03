// Unit на withIdempotency — ядро инварианта «ровно один эффект» офлайн-досылки (preflight-аудит В7).
// prisma и Prisma-класс ошибок мокируются: тестируем именно логику барьера, без БД.
import { vi, describe, it, expect, beforeEach } from "vitest";

// Всё, к чему обращаются hoisted-фабрики vi.mock, определяем внутри vi.hoisted — иначе ReferenceError.
const { findUnique, create, deleteMany, FakeKnownError } = vi.hoisted(() => {
  // Подмена класса известной ошибки Prisma — для проверки ветки P2002 без реального клиента.
  class FakeKnownError extends Error {
    code: string;
    constructor(code: string) {
      super("prisma");
      this.code = code;
    }
  }
  return { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), FakeKnownError };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { processedAction: { findUnique, create, deleteMany } },
}));
vi.mock("@/generated/prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakeKnownError },
}));

import { withIdempotency, cleanupProcessedActions } from "./idempotency";

const ME = { id: "user-a" };

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
  deleteMany.mockReset();
});

describe("withIdempotency — exactly-once офлайн-досылки (preflight-аудит В7)", () => {
  it("пустой ключ → run() выполняется, реестр не трогаем (обычный онлайн-запрос)", async () => {
    const run = vi.fn().mockResolvedValue({ ok: 1 });
    const r = await withIdempotency(null, ME, "k", run);
    expect(r).toEqual({ ok: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("ключ из пробелов → как без ключа (trim → пусто)", async () => {
    const run = vi.fn().mockResolvedValue("x");
    await withIdempotency("   ", ME, "k", run);
    expect(findUnique).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("новый ключ → run() ровно один раз и результат сохраняется в реестр", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({});
    const run = vi.fn().mockResolvedValue({ v: 42 });
    const r = await withIdempotency("key1", ME, "transition", run);
    expect(r).toEqual({ v: 42 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ key: "key1", userId: "user-a", kind: "transition" });
  });

  it("повтор того же ключа того же юзера → run() НЕ вызывается, возвращается снимок", async () => {
    findUnique.mockResolvedValue({ userId: "user-a", resultJson: { cached: true } });
    const run = vi.fn();
    const r = await withIdempotency("key1", ME, "transition", run);
    expect(r).toEqual({ cached: true });
    expect(run).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("чужой ключ → 404, эффект не выполняется (изоляция, CLAUDE.md §1)", async () => {
    findUnique.mockResolvedValue({ userId: "user-b", resultJson: { secret: true } });
    const run = vi.fn();
    await expect(withIdempotency("key1", ME, "transition", run)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(run).not.toHaveBeenCalled();
  });

  it("run() бросил → реестр НЕ пишем (повтор досылки может оказаться валидным)", async () => {
    findUnique.mockResolvedValue(null);
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withIdempotency("key1", ME, "transition", run)).rejects.toThrow("boom");
    expect(create).not.toHaveBeenCalled();
  });

  it("P2002 при сохранении (параллельная гонка) → не падаем, возвращаем результат", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new FakeKnownError("P2002"));
    const run = vi.fn().mockResolvedValue({ done: true });
    const r = await withIdempotency("key1", ME, "transition", run);
    expect(r).toEqual({ done: true });
  });

  it("прочая ошибка create → пробрасывается (не глотаем)", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new FakeKnownError("P9999"));
    const run = vi.fn().mockResolvedValue({ done: true });
    await expect(withIdempotency("key1", ME, "transition", run)).rejects.toBeInstanceOf(FakeKnownError);
  });
});

describe("cleanupProcessedActions — TTL реестра (O11)", () => {
  it("удаляет записи старше N дней (cutoff = now − N·сутки)", async () => {
    deleteMany.mockResolvedValue({ count: 7 });
    const now = new Date("2026-07-03T04:00:00.000Z");
    const removed = await cleanupProcessedActions(60, now);
    expect(removed).toBe(7);
    const where = deleteMany.mock.calls[0][0].where;
    const cutoff = where.createdAt.lt as Date;
    // 60 суток назад от 03.07 → 04.05
    expect(cutoff.toISOString()).toBe("2026-05-04T04:00:00.000Z");
  });

  it("порог 60 дней ≫ окна достоверности 36 ч — свежие записи не трогаем", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    const now = new Date("2026-07-03T00:00:00.000Z");
    await cleanupProcessedActions(60, now);
    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(60 * 24 * 60 * 60 * 1000);
  });
});
