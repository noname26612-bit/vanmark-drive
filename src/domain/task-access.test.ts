import { describe, it, expect } from "vitest";
import { isTaskManagerRole, assertTaskManager } from "./task-access";
import { isDispatcherRole, checkTransition } from "./task-status";
import { canViewTask } from "./authz";
import type { Role } from "@/generated/prisma/enums";

const ALL_ROLES: Role[] = ["ADMIN", "DISPATCHER", "DRIVER", "SERVICE_MANAGER"];

// Расщепление прав 11.08.2026: заявки — шире, смены/KPI/деньги — как были. Тесты фиксируют ГРАНИЦУ,
// потому что именно она защищает Максима от чужих разделов, а Милену — от потери своих.
describe("isTaskManagerRole — кто ведёт заявки", () => {
  it("пускает диспетчера, админа и менеджера-сервисника", () => {
    expect(isTaskManagerRole("DISPATCHER")).toBe(true);
    expect(isTaskManagerRole("ADMIN")).toBe(true);
    expect(isTaskManagerRole("SERVICE_MANAGER")).toBe(true);
  });

  it("водителя не пускает (у него только свои задачи)", () => {
    expect(isTaskManagerRole("DRIVER")).toBe(false);
    expect(() => assertTaskManager({ role: "DRIVER" })).toThrow();
  });

  it("это белый список: любая роль вне перечисления закрыта по умолчанию", () => {
    const allowed = ALL_ROLES.filter(isTaskManagerRole);
    expect(allowed).toEqual(["ADMIN", "DISPATCHER", "SERVICE_MANAGER"]);
  });
});

describe("isDispatcherRole — смены, KPI, деньги (не расширялся)", () => {
  it("менеджер-сервисник в диспетчерский контур НЕ входит", () => {
    expect(isDispatcherRole("SERVICE_MANAGER")).toBe(false);
    expect(isDispatcherRole("DRIVER")).toBe(false);
    expect(isDispatcherRole("DISPATCHER")).toBe(true);
    expect(isDispatcherRole("ADMIN")).toBe(true);
  });

  it("два списка не совпадают — иначе расщепление прав было бы бессмысленным", () => {
    const taskOnly = ALL_ROLES.filter((r) => isTaskManagerRole(r) && !isDispatcherRole(r));
    expect(taskOnly).toEqual(["SERVICE_MANAGER"]);
  });
});

describe("видимость и статусы заявки для менеджера-сервисника", () => {
  const foreign = { assigneeId: "driver-a", coDriverId: null };

  it("видит любую заявку, как диспетчер", () => {
    expect(canViewTask({ id: "maxim", role: "SERVICE_MANAGER" }, foreign)).toBe(true);
  });

  it("ведёт статусы: может отменить и вернуть в работу (матрица не менялась)", () => {
    const actor = { role: "SERVICE_MANAGER" as Role, isAssignee: false };
    expect(checkTransition(actor, "ASSIGNED", "CANCELLED")).toEqual({ ok: true, reasonRequired: true });
    expect(checkTransition(actor, "NEW", "ASSIGNED")).toEqual({ ok: true, reasonRequired: false });
  });

  it("несуществующий переход остаётся невалидным и для него", () => {
    const actor = { role: "SERVICE_MANAGER" as Role, isAssignee: false };
    expect(checkTransition(actor, "DONE", "RESCHEDULED").ok).toBe(false);
  });

  it("водитель по-прежнему не видит чужую заявку", () => {
    expect(canViewTask({ id: "driver-b", role: "DRIVER" }, foreign)).toBe(false);
  });
});
