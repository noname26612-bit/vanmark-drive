import { describe, it, expect } from "vitest";
import { homeForRole, roleLabel } from "./roles";

describe("roles", () => {
  it("homeForRole разводит роли по стартовым экранам", () => {
    expect(homeForRole("ADMIN")).toBe("/admin");
    expect(homeForRole("DISPATCHER")).toBe("/board");
    expect(homeForRole("DRIVER")).toBe("/m");
    // Менеджер-сервисник (05.08.2026): весь его сервис — картотека станков, задач он не видит.
    expect(homeForRole("SERVICE_MANAGER")).toBe("/machines");
    // Сотрудник без входа (18.08.2026): стартового экрана нет — он не входит в систему вообще.
    // Инвариант держат canLogin=false, случайный пароль и 404 на всех ручках включения входа.
    expect(homeForRole("EMPLOYEE")).toBe("/login");
  });

  it("roleLabel — человекочитаемо по-русски", () => {
    expect(roleLabel("ADMIN")).toBe("Администратор");
    expect(roleLabel("DISPATCHER")).toBe("Диспетчер");
    expect(roleLabel("DRIVER")).toBe("Водитель");
    expect(roleLabel("SERVICE_MANAGER")).toBe("Менеджер-сервисник");
    expect(roleLabel("EMPLOYEE")).toBe("Сотрудник");
  });
});
