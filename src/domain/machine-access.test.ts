import { describe, it, expect } from "vitest";
import { isMachineRole, assertMachineAccess } from "./machine-access";
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
