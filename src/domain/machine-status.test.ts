import { describe, it, expect } from "vitest";
import {
  MACHINE_CATEGORIES,
  MACHINE_STATUSES,
  categoriesForStatus,
  isArchivedStatus,
  isOurCategory,
  isStatusAllowedForCategory,
  reasonRequiredFor,
  statusesForCategory,
  MACHINE_STATUS_LABEL,
  MACHINE_CATEGORY_LABEL,
} from "./machine-status";
import type { MachineCategory, MachineStatus } from "@/generated/prisma/enums";

describe("machine-status: совместимость состояния и категории", () => {
  it("«В аренде» — только у нашего арендного", () => {
    expect(isStatusAllowedForCategory("OUR_RENTAL", "RENTED")).toBe(true);
    expect(isStatusAllowedForCategory("OUR_SALE", "RENTED")).toBe(false);
    expect(isStatusAllowedForCategory("CLIENT", "RENTED")).toBe(false);
  });

  it("«Продан» — только у нашего на продажу", () => {
    expect(isStatusAllowedForCategory("OUR_SALE", "SOLD")).toBe(true);
    expect(isStatusAllowedForCategory("OUR_RENTAL", "SOLD")).toBe(false);
    expect(isStatusAllowedForCategory("CLIENT", "SOLD")).toBe(false);
  });

  it("«Выдан клиенту» — только у клиентского", () => {
    expect(isStatusAllowedForCategory("CLIENT", "RELEASED")).toBe(true);
    expect(isStatusAllowedForCategory("OUR_SALE", "RELEASED")).toBe(false);
    expect(isStatusAllowedForCategory("OUR_RENTAL", "RELEASED")).toBe(false);
  });

  it("рабочие состояния допустимы в любой категории", () => {
    const free: MachineStatus[] = ["ACCEPTED", "NEEDS_REPAIR", "IN_REPAIR", "READY", "VOIDED"];
    for (const category of MACHINE_CATEGORIES) {
      for (const status of free) {
        expect(isStatusAllowedForCategory(category, status)).toBe(true);
      }
    }
  });

  it("каждая пара «категория × состояние» имеет однозначный вердикт", () => {
    const pairs: [MachineCategory, MachineStatus, boolean][] = [];
    for (const c of MACHINE_CATEGORIES) {
      for (const s of MACHINE_STATUSES) pairs.push([c, s, isStatusAllowedForCategory(c, s)]);
    }
    // 3 категории × 8 состояний; запрещены ровно 6 пар (по 2 «чужих» категории на 3 привязанных статуса).
    expect(pairs).toHaveLength(24);
    expect(pairs.filter(([, , ok]) => !ok)).toHaveLength(6);
  });

  it("statusesForCategory не предлагает заведомо неверное", () => {
    expect(statusesForCategory("CLIENT")).not.toContain("SOLD");
    expect(statusesForCategory("CLIENT")).not.toContain("RENTED");
    expect(statusesForCategory("CLIENT")).toContain("RELEASED");
    expect(statusesForCategory("OUR_RENTAL")).toContain("RENTED");
    expect(statusesForCategory("OUR_SALE")).toContain("SOLD");
  });

  it("categoriesForStatus — обратная подсказка при смене категории", () => {
    expect(categoriesForStatus("RENTED")).toEqual(["OUR_RENTAL"]);
    expect(categoriesForStatus("READY")).toEqual(["CLIENT", "OUR_SALE", "OUR_RENTAL"]);
  });
});

describe("machine-status: архив", () => {
  it("архивные — выдан, продан, аннулирован", () => {
    expect(isArchivedStatus("RELEASED")).toBe(true);
    expect(isArchivedStatus("SOLD")).toBe(true);
    expect(isArchivedStatus("VOIDED")).toBe(true);
  });

  it("«В аренде» НЕ архив — аренда возвращается в цикл (поправка совета)", () => {
    expect(isArchivedStatus("RENTED")).toBe(false);
  });

  it("рабочие состояния не архивные", () => {
    for (const s of ["ACCEPTED", "NEEDS_REPAIR", "IN_REPAIR", "READY"] as MachineStatus[]) {
      expect(isArchivedStatus(s)).toBe(false);
    }
  });

  it("причина обязательна только при аннулировании", () => {
    expect(reasonRequiredFor("VOIDED")).toBe(true);
    for (const s of MACHINE_STATUSES.filter((x) => x !== "VOIDED")) {
      expect(reasonRequiredFor(s)).toBe(false);
    }
  });
});

describe("machine-status: подписи и категории", () => {
  it("наши станки — продажа и аренда (им положен номер 77-N)", () => {
    expect(isOurCategory("OUR_SALE")).toBe(true);
    expect(isOurCategory("OUR_RENTAL")).toBe(true);
    expect(isOurCategory("CLIENT")).toBe(false);
  });

  it("у каждого состояния и категории есть русская подпись", () => {
    for (const s of MACHINE_STATUSES) expect(MACHINE_STATUS_LABEL[s]?.length).toBeGreaterThan(0);
    for (const c of MACHINE_CATEGORIES) expect(MACHINE_CATEGORY_LABEL[c]?.length).toBeGreaterThan(0);
  });
});
