import { describe, it, expect } from "vitest";
import { canViewTask, isAssignee, type Viewer } from "./authz";

const admin: Viewer = { id: "u-admin", role: "ADMIN" };
const dispatcher: Viewer = { id: "u-disp", role: "DISPATCHER" };
const driverA: Viewer = { id: "u-a", role: "DRIVER" };
const driverB: Viewer = { id: "u-b", role: "DRIVER" };

describe("authz: видимость задач", () => {
  it("диспетчер и админ видят любую задачу", () => {
    expect(canViewTask(dispatcher, { assigneeId: "u-a" })).toBe(true);
    expect(canViewTask(dispatcher, { assigneeId: null })).toBe(true);
    expect(canViewTask(admin, { assigneeId: "u-b" })).toBe(true);
  });

  it("водитель видит только свою задачу", () => {
    expect(canViewTask(driverA, { assigneeId: "u-a" })).toBe(true);
    expect(canViewTask(driverA, { assigneeId: "u-b" })).toBe(false);
    expect(canViewTask(driverB, { assigneeId: "u-a" })).toBe(false);
  });

  it("водитель не видит неназначенную задачу", () => {
    expect(canViewTask(driverA, { assigneeId: null })).toBe(false);
  });

  it("isAssignee", () => {
    expect(isAssignee(driverA, { assigneeId: "u-a" })).toBe(true);
    expect(isAssignee(driverA, { assigneeId: "u-b" })).toBe(false);
    expect(isAssignee(driverA, { assigneeId: null })).toBe(false);
  });
});
