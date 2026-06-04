import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password (argon2id)", () => {
  it("хэш в формате argon2id и не содержит исходный пароль", async () => {
    const h = await hashPassword("vanmark123");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain("vanmark123");
  });

  it("verify принимает верный и отвергает неверный пароль", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });

  it("одинаковые пароли дают разные хэши (соль)", async () => {
    const a = await hashPassword("same-pass");
    const b = await hashPassword("same-pass");
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same-pass")).toBe(true);
    expect(await verifyPassword(b, "same-pass")).toBe(true);
  });
});
