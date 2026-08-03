// Unit на требования к паролю при админ-сбросе (03.08).
import { describe, it, expect } from "vitest";
import { assertPasswordStrength, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN } from "./password-policy";

describe("assertPasswordStrength", () => {
  it("нормальный пароль проходит", () => {
    expect(() => assertPasswordStrength("vanmark2026", "nikolay")).not.toThrow();
  });

  it("пустой или из пробелов → validation", () => {
    expect(() => assertPasswordStrength("", "nikolay")).toThrowError(/Введите пароль/);
    expect(() => assertPasswordStrength("        ", "nikolay")).toThrowError(/Введите пароль/);
  });

  it("короче минимума → validation, ровно минимум — проходит", () => {
    expect(() => assertPasswordStrength("a".repeat(MIN_PASSWORD_LEN - 1), "nikolay")).toThrowError(
      /короче/,
    );
    expect(() => assertPasswordStrength("a".repeat(MIN_PASSWORD_LEN), "nikolay")).not.toThrow();
  });

  it("длиннее максимума → validation, ровно максимум — проходит", () => {
    expect(() => assertPasswordStrength("a".repeat(MAX_PASSWORD_LEN), "nikolay")).not.toThrow();
    expect(() => assertPasswordStrength("a".repeat(MAX_PASSWORD_LEN + 1), "nikolay")).toThrowError(
      /длиннее/,
    );
  });

  it("совпадение с логином (в любом регистре) → validation", () => {
    expect(() => assertPasswordStrength("nikolay1", "nikolay1")).toThrowError(/логином/);
    expect(() => assertPasswordStrength("NIKOLAY1", "nikolay1")).toThrowError(/логином/);
  });
});
