import { describe, it, expect } from "vitest";
import { canViewTask, isAssignee, type Viewer, type OwnedTask } from "./authz";

const admin: Viewer = { id: "u-admin", role: "ADMIN" };
const dispatcher: Viewer = { id: "u-disp", role: "DISPATCHER" };
const driverA: Viewer = { id: "u-a", role: "DRIVER" };
const driverB: Viewer = { id: "u-b", role: "DRIVER" };
const driverC: Viewer = { id: "u-c", role: "DRIVER" };

const t = (assigneeId: string | null, coDriverId: string | null = null): OwnedTask => ({
  assigneeId,
  coDriverId,
});

describe("authz: видимость задач", () => {
  it("диспетчер и админ видят любую задачу", () => {
    expect(canViewTask(dispatcher, t("u-a"))).toBe(true);
    expect(canViewTask(dispatcher, t(null))).toBe(true);
    expect(canViewTask(admin, t("u-b"))).toBe(true);
  });

  it("водитель видит только свою задачу", () => {
    expect(canViewTask(driverA, t("u-a"))).toBe(true);
    expect(canViewTask(driverA, t("u-b"))).toBe(false);
    expect(canViewTask(driverB, t("u-a"))).toBe(false);
  });

  it("водитель не видит неназначенную задачу", () => {
    expect(canViewTask(driverA, t(null))).toBe(false);
  });

  it("isAssignee", () => {
    expect(isAssignee(driverA, { assigneeId: "u-a" })).toBe(true);
    expect(isAssignee(driverA, { assigneeId: "u-b" })).toBe(false);
    expect(isAssignee(driverA, { assigneeId: null })).toBe(false);
  });
});

describe("authz: напарник (20.07.2026)", () => {
  it("напарник ВИДИТ парную задачу", () => {
    expect(canViewTask(driverB, t("u-a", "u-b"))).toBe(true);
  });

  it("напарник НЕ исполнитель: isAssignee=false — матрица и ведомость закрыты", () => {
    expect(isAssignee(driverB, t("u-a", "u-b"))).toBe(false);
  });

  it("третий водитель не видит парную задачу", () => {
    expect(canViewTask(driverC, t("u-a", "u-b"))).toBe(false);
  });

  it("ответственный видит парную задачу как раньше", () => {
    expect(canViewTask(driverA, t("u-a", "u-b"))).toBe(true);
    expect(isAssignee(driverA, t("u-a", "u-b"))).toBe(true);
  });
});
