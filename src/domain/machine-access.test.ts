import { describe, it, expect } from "vitest";
import { canAccessEquipment, isMachineRole, assertMachineAccess } from "./machine-access";
import { DomainError } from "./errors";

describe("machine-access: кто работает с картотекой", () => {
  it("модуль открыт трём ролям (PRD §16): сервисник, диспетчер, админ", () => {
    expect(isMachineRole("SERVICE_MANAGER")).toBe(true);
    expect(isMachineRole("DISPATCHER")).toBe(true);
    expect(isMachineRole("ADMIN")).toBe(true);
  });

  it("водитель в модуль не входит", () => {
    expect(isMachineRole("DRIVER")).toBe(false);
  });

  it("водителю отдаём 404, а не 403 — существование модуля не раскрываем", () => {
    let caught: unknown;
    try {
      assertMachineAccess({ role: "DRIVER" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("NOT_FOUND");
    expect((caught as DomainError).httpStatus).toBe(404);
  });

  it("разрешённые роли проходят без исключения", () => {
    expect(() => assertMachineAccess({ role: "SERVICE_MANAGER" })).not.toThrow();
    expect(() => assertMachineAccess({ role: "DISPATCHER" })).not.toThrow();
    expect(() => assertMachineAccess({ role: "ADMIN" })).not.toThrow();
  });
});

// Персональный доступ (15.08.2026, Николай и Александр) — единственное право не по роли. Тесты
// держат границу: флаг ТОЛЬКО открывает оборудование и не превращает водителя в штаб.
describe("machine-access: персональный флаг доступа", () => {
  it("водитель с флагом допущен к оборудованию", () => {
    expect(canAccessEquipment({ role: "DRIVER", equipmentAccess: true })).toBe(true);
    expect(() => assertMachineAccess({ role: "DRIVER", equipmentAccess: true })).not.toThrow();
  });

  it("водитель без флага по-прежнему получает 404", () => {
    expect(canAccessEquipment({ role: "DRIVER" })).toBe(false);
    expect(canAccessEquipment({ role: "DRIVER", equipmentAccess: false })).toBe(false);
    expect(() => assertMachineAccess({ role: "DRIVER", equipmentAccess: false })).toThrow(DomainError);
  });

  it("флаг не подменяет роль: ролевые списки его не видят", () => {
    // isMachineRole остаётся чисто ролевым предикатом — им закрыты выборка ответственных и
    // ветка guard'а, где лишний запрос к БД не нужен.
    expect(isMachineRole("DRIVER")).toBe(false);
  });

  it("ролям флаг не нужен и не мешает", () => {
    expect(canAccessEquipment({ role: "ADMIN" })).toBe(true);
    expect(canAccessEquipment({ role: "DISPATCHER", equipmentAccess: false })).toBe(true);
  });
});
