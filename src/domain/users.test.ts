// Unit на админ-действия с учётками (03.08 — водители, 22.08.2026 — офис).
// Главное, что проверяем:
//   • водительские признаки (внешний, оборудование, задачи цеха) не трогают НЕ водителя;
//   • пароль и вход работают с учётками СО ВХОДОМ, а сотрудник без входа (EMPLOYEE) → 404;
//   • себе и последнему администратору вход закрыть нельзя — иначе система запирается изнутри.
import { vi, describe, it, expect, beforeEach } from "vitest";

const { findUnique, update, count } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique, update, count } } }));
vi.mock("@/lib/password", () => ({
  hashPassword: (plain: string) => Promise.resolve(`hashed:${plain}`),
}));

import { setDriverExternal, setUserPassword, setUserLoginAccess } from "./users";

const DRIVER = { id: "drv-1", role: "DRIVER", login: "nikolay", isActive: true };
const DISPATCHER = { id: "u-2", role: "DISPATCHER", login: "milena", isActive: true };
const ADMIN = { id: "u-3", role: "ADMIN", login: "artem", isActive: true };
const EMPLOYEE = { id: "u-9", role: "EMPLOYEE", login: "tsekh", isActive: true };

function accessRow(over: Record<string, unknown> = {}) {
  return {
    id: "drv-1",
    name: "Николай",
    login: "nikolay",
    role: "DRIVER",
    position: null,
    canLogin: true,
    isExternal: false,
    equipmentAccess: false,
    staffTasksAccess: false,
    payProfile: null,
    ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  count.mockReset();
  update.mockImplementation(({ data }) => Promise.resolve(accessRow(data)));
});

describe("setDriverExternal", () => {
  it("водителя помечает внешним", async () => {
    findUnique.mockResolvedValue(DRIVER);
    const view = await setDriverExternal("drv-1", true);
    expect(update.mock.calls[0][0].data).toEqual({ isExternal: true });
    expect(view.isExternal).toBe(true);
  });

  it("диспетчера трогать нельзя → 404 (признак существует только у водителя)", async () => {
    findUnique.mockResolvedValue(DISPATCHER);
    await expect(setDriverExternal("u-2", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("setUserPassword", () => {
  it("сохраняет ХЭШ, а не сам пароль, и не возвращает секретов", async () => {
    findUnique.mockResolvedValue(DRIVER);
    const view = await setUserPassword("drv-1", "vanmark2026");
    const data = update.mock.calls[0][0].data;
    // В БД уходит только хэш (прошёл через hashPassword) и ничего больше.
    expect(data.passwordHash).toBe("hashed:vanmark2026");
    expect(Object.keys(data)).toEqual(["passwordHash"]);
    // В ответе секретов нет вообще.
    expect(view).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(view)).not.toContain("hashed:");
  });

  it("учётке офиса пароль сменить можно (решение Артёма 22.08.2026)", async () => {
    findUnique.mockResolvedValue(DISPATCHER);
    await setUserPassword("u-2", "vanmark2026");
    expect(update.mock.calls[0][0].data.passwordHash).toBe("hashed:vanmark2026");
  });

  it("сотруднику без входа (EMPLOYEE) — 404: доступа у него нет by design", async () => {
    findUnique.mockResolvedValue(EMPLOYEE);
    await expect(setUserPassword("u-9", "vanmark2026")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });

  it("слабый пароль → validation, запись не происходит", async () => {
    findUnique.mockResolvedValue(DRIVER);
    await expect(setUserPassword("drv-1", "123")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(update).not.toHaveBeenCalled();
  });

  it("несуществующий пользователь → 404", async () => {
    findUnique.mockResolvedValue(null);
    await expect(setUserPassword("nope", "vanmark2026")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("уволенный (isActive=false) → 404", async () => {
    findUnique.mockResolvedValue({ ...DRIVER, isActive: false });
    await expect(setUserPassword("drv-1", "vanmark2026")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setUserLoginAccess", () => {
  it("сотруднику без входа (EMPLOYEE) — 404", async () => {
    findUnique.mockResolvedValue(EMPLOYEE);
    await expect(setUserLoginAccess("u-3", "u-9", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });

  it("диспетчеру вход выключается (22.08.2026: ручка работает с учётками офиса)", async () => {
    findUnique.mockResolvedValue(DISPATCHER);
    await setUserLoginAccess("u-3", "u-2", false);
    expect(update.mock.calls[0][0].data).toEqual({ canLogin: false });
  });

  it("СЕБЕ вход закрыть нельзя — иначе администратор запирает сам себя", async () => {
    findUnique.mockResolvedValue(ADMIN);
    await expect(setUserLoginAccess("u-3", "u-3", false)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(update).not.toHaveBeenCalled();
  });

  it("себе вход РАЗРЕШИТЬ можно — этим систему не запереть", async () => {
    findUnique.mockResolvedValue(ADMIN);
    await setUserLoginAccess("u-3", "u-3", true);
    expect(update.mock.calls[0][0].data).toEqual({ canLogin: true });
  });

  it("последнего администратора со входом не выключить → LAST_ADMIN", async () => {
    findUnique.mockResolvedValue({ ...ADMIN, id: "u-4", login: "mikhail" });
    count.mockResolvedValue(0); // других активных админов со входом нет
    await expect(setUserLoginAccess("u-3", "u-4", false)).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("второму администратору вход выключить можно, пока остаётся хотя бы один", async () => {
    findUnique.mockResolvedValue({ ...ADMIN, id: "u-4", login: "mikhail" });
    count.mockResolvedValue(1);
    await setUserLoginAccess("u-3", "u-4", false);
    expect(update.mock.calls[0][0].data).toEqual({ canLogin: false });
    // Считаем ДРУГИХ админов — сам выключаемый в счёт не идёт.
    expect(count.mock.calls[0][0].where.id).toEqual({ not: "u-4" });
  });
});
