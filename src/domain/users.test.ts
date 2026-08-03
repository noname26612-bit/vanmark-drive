// Unit на админ-действия с водителями (03.08): признак «внешний» и смена пароля.
// Главное, что проверяем — нельзя тронуть НЕ водителя: иначе через эти ручки можно было бы
// перехватить учётку диспетчера или админа.
import { vi, describe, it, expect, beforeEach } from "vitest";

const { findUnique, update } = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique, update } } }));
vi.mock("@/lib/password", () => ({
  hashPassword: (plain: string) => Promise.resolve(`hashed:${plain}`),
}));

import { setDriverExternal, setDriverPassword, setDriverLoginAccess } from "./users";

const DRIVER = { id: "drv-1", role: "DRIVER", login: "nikolay" };

function accessRow(over: Record<string, unknown> = {}) {
  return {
    id: "drv-1",
    name: "Николай",
    login: "nikolay",
    canLogin: true,
    isExternal: false,
    payProfile: null,
    ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  update.mockImplementation(({ data }) => Promise.resolve(accessRow(data)));
});

describe("setDriverExternal", () => {
  it("водителя помечает внешним", async () => {
    findUnique.mockResolvedValue(DRIVER);
    const view = await setDriverExternal("drv-1", true);
    expect(update.mock.calls[0][0].data).toEqual({ isExternal: true });
    expect(view.isExternal).toBe(true);
  });

  it("диспетчера трогать нельзя → 404", async () => {
    findUnique.mockResolvedValue({ id: "u-2", role: "DISPATCHER", login: "milena" });
    await expect(setDriverExternal("u-2", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("setDriverPassword", () => {
  it("сохраняет ХЭШ, а не сам пароль, и не возвращает секретов", async () => {
    findUnique.mockResolvedValue(DRIVER);
    const view = await setDriverPassword("drv-1", "vanmark2026");
    const data = update.mock.calls[0][0].data;
    // В БД уходит только хэш (прошёл через hashPassword) и ничего больше.
    expect(data.passwordHash).toBe("hashed:vanmark2026");
    expect(Object.keys(data)).toEqual(["passwordHash"]);
    // В ответе секретов нет вообще.
    expect(view).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(view)).not.toContain("hashed:");
  });

  it("админу пароль сменить нельзя → 404 (защита от захвата учётки)", async () => {
    findUnique.mockResolvedValue({ id: "u-3", role: "ADMIN", login: "artem" });
    await expect(setDriverPassword("u-3", "vanmark2026")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });

  it("слабый пароль → validation, запись не происходит", async () => {
    findUnique.mockResolvedValue(DRIVER);
    await expect(setDriverPassword("drv-1", "123")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(update).not.toHaveBeenCalled();
  });

  it("несуществующий водитель → 404", async () => {
    findUnique.mockResolvedValue(null);
    await expect(setDriverPassword("nope", "vanmark2026")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setDriverLoginAccess", () => {
  it("не водителя трогать нельзя → 404", async () => {
    findUnique.mockResolvedValue({ id: "u-2", role: "DISPATCHER", login: "milena" });
    await expect(setDriverLoginAccess("u-2", false)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });
});
