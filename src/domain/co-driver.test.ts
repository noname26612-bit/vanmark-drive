import { describe, it, expect } from "vitest";
import { resolveCoDriverOnAssign, validateCoDriver, CoDriverRuleError } from "./co-driver";

const A = "driver-a";
const B = "driver-b";
const C = "driver-c";

describe("resolveCoDriverOnAssign — судьба напарника при смене ответственного", () => {
  it("нет напарника — ничего не происходит при любой смене", () => {
    expect(resolveCoDriverOnAssign({ assigneeId: A, coDriverId: null }, B)).toEqual({
      coDriverId: null,
      event: null,
    });
    expect(resolveCoDriverOnAssign({ assigneeId: null, coDriverId: null }, A)).toEqual({
      coDriverId: null,
      event: null,
    });
  });

  it("тот же ответственный — пара не меняется", () => {
    expect(resolveCoDriverOnAssign({ assigneeId: A, coDriverId: B }, A)).toEqual({
      coDriverId: B,
      event: null,
    });
  });

  it("назначение на напарника — swap ролей (пара сохраняется)", () => {
    expect(resolveCoDriverOnAssign({ assigneeId: A, coDriverId: B }, B)).toEqual({
      coDriverId: A,
      event: "swap",
    });
  });

  it("назначение третьего водителя — напарник снимается", () => {
    expect(resolveCoDriverOnAssign({ assigneeId: A, coDriverId: B }, C)).toEqual({
      coDriverId: null,
      event: "removed",
    });
  });

  it("снятие назначения — напарник снимается (пара без ответственного запрещена)", () => {
    expect(resolveCoDriverOnAssign({ assigneeId: A, coDriverId: B }, null)).toEqual({
      coDriverId: null,
      event: "removed",
    });
  });
});

describe("validateCoDriver — инварианты пары при создании/правке", () => {
  it("null проходит всегда", () => {
    expect(validateCoDriver(null, null)).toBeNull();
    expect(validateCoDriver(null, A)).toBeNull();
  });

  it("напарник без ответственного — ошибка", () => {
    expect(() => validateCoDriver(B, null)).toThrow(CoDriverRuleError);
  });

  it("напарник == ответственный — ошибка", () => {
    expect(() => validateCoDriver(A, A)).toThrow(CoDriverRuleError);
  });

  it("валидная пара проходит", () => {
    expect(validateCoDriver(B, A)).toBe(B);
  });
});
