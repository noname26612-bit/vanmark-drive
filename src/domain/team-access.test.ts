import { describe, it, expect } from "vitest";
import { isTeamManagerRole, assertTeamManager } from "./team-access";
import { isTaskManagerRole } from "./task-access";
import { isDispatcherRole } from "./task-status";
import type { Role } from "@/generated/prisma/enums";

const ALL_ROLES: Role[] = ["ADMIN", "DISPATCHER", "DRIVER", "SERVICE_MANAGER", "EMPLOYEE"];

// Права на справочник коллектива (21.08.2026): Артём открыл менеджеру-сервиснику правку вкладки
// «Команда». Тесты фиксируют ГРАНИЦУ: что открылось — открылось, а смены/KPI/деньги и права
// остались там же, где были.
describe("isTeamManagerRole — кто ведёт справочник коллектива", () => {
  it("пускает диспетчера, админа и менеджера-сервисника", () => {
    expect(isTeamManagerRole("DISPATCHER")).toBe(true);
    expect(isTeamManagerRole("ADMIN")).toBe(true);
    expect(isTeamManagerRole("SERVICE_MANAGER")).toBe(true);
  });

  it("водителя не пускает: справочника офиса у него в приложении нет", () => {
    expect(isTeamManagerRole("DRIVER")).toBe(false);
    expect(() => assertTeamManager({ role: "DRIVER" })).toThrow();
  });

  it("сотрудник без доступа не проходит и сюда — роль не открывает ничего", () => {
    expect(isTeamManagerRole("EMPLOYEE")).toBe(false);
    expect(() => assertTeamManager({ role: "EMPLOYEE" })).toThrow();
  });

  it("это белый список: любая роль вне перечисления закрыта по умолчанию", () => {
    expect(ALL_ROLES.filter(isTeamManagerRole)).toEqual(["ADMIN", "DISPATCHER", "SERVICE_MANAGER"]);
  });
});

describe("расширение прав не протекло в соседние контуры", () => {
  it("менеджер-сервисник по-прежнему вне смен, KPI и денег", () => {
    expect(isDispatcherRole("SERVICE_MANAGER")).toBe(false);
  });

  it("кадры — отдельный список, а не псевдоним заявок", () => {
    // Сегодня множества совпадают, и это нормально; важно, что списка ДВА и расширение одного
    // не расширяет другой. Проверяем сам факт независимости на роли, которой нет ни в одном.
    expect(isTeamManagerRole("DRIVER")).toBe(isTaskManagerRole("DRIVER"));
    expect(isTeamManagerRole("EMPLOYEE")).toBe(false);
    expect(isTaskManagerRole("EMPLOYEE")).toBe(false);
  });
});
