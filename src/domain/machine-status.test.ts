import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_FAMILIES,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_PLURAL,
  EQUIPMENT_KIND_SHORT,
  KINDS_BY_FAMILY,
  MACHINE_CATEGORIES,
  MACHINE_STATUSES,
  categoriesForStatus,
  categoryFollowingStatus,
  selectableStatuses,
  familyOfKind,
  headKindOf,
  isArchivedStatus,
  isHeadKind,
  isKindInFamily,
  isOurCategory,
  isStatusAllowedForCategory,
  isStockKind,
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

describe("machine-status: кнопки состояний в карточке (15.08.2026)", () => {
  it("у своего железа кнопками доступны и «Продан», и «В аренде»", () => {
    for (const our of ["OUR_SALE", "OUR_RENTAL"] as const) {
      expect(selectableStatuses(our)).toContain("SOLD");
      expect(selectableStatuses(our)).toContain("RENTED");
      expect(selectableStatuses(our)).not.toContain("RELEASED"); // выдают только чужое
    }
  });

  it("у клиентского — только «Выдан клиенту»: чужой станок не продают и не сдают", () => {
    expect(selectableStatuses("CLIENT")).toContain("RELEASED");
    expect(selectableStatuses("CLIENT")).not.toContain("SOLD");
    expect(selectableStatuses("CLIENT")).not.toContain("RENTED");
  });

  it("порядок кнопок — порядок жизненного цикла, без дублей", () => {
    const list = selectableStatuses("OUR_SALE");
    expect(list).toEqual([...new Set(list)]);
    expect(list.indexOf("READY")).toBeLessThan(list.indexOf("SOLD"));
    expect(list.at(-1)).toBe("VOIDED"); // аннулирование — всегда последним
  });

  it("категория едет за состоянием: продали арендный — он «наш на продажу»", () => {
    expect(categoryFollowingStatus("OUR_RENTAL", "SOLD")).toBe("OUR_SALE");
    expect(categoryFollowingStatus("OUR_SALE", "RENTED")).toBe("OUR_RENTAL");
  });

  it("менять нечего, когда состояние и так подходит", () => {
    expect(categoryFollowingStatus("OUR_SALE", "SOLD")).toBeNull();
    expect(categoryFollowingStatus("OUR_RENTAL", "READY")).toBeNull();
    expect(categoryFollowingStatus("CLIENT", "RELEASED")).toBeNull();
  });

  it("клиентский станок не переезжает в наши категории сам", () => {
    expect(categoryFollowingStatus("CLIENT", "SOLD")).toBeNull();
    expect(categoryFollowingStatus("CLIENT", "RENTED")).toBeNull();
  });

  it("«Выдан клиенту» не делает наш станок клиентским", () => {
    expect(categoryFollowingStatus("OUR_SALE", "RELEASED")).toBeNull();
    expect(categoryFollowingStatus("OUR_RENTAL", "RELEASED")).toBeNull();
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

// Разделы оборудования (решение Артёма 15.08.2026). Тесты держат границу «вид принадлежит своему
// разделу»: именно она не даёт размотчику появиться у листогибов, а ножу — у фальцепрокатников.
describe("machine-status: разделы и виды", () => {
  it("каждый вид принадлежит ровно одному разделу", () => {
    for (const family of EQUIPMENT_FAMILIES) {
      for (const kind of KINDS_BY_FAMILY[family]) {
        expect(familyOfKind(kind)).toBe(family);
        expect(isKindInFamily(family, kind)).toBe(true);
      }
    }
  });

  it("вид из чужого раздела не проходит", () => {
    expect(isKindInFamily("BENDER", "UNCOILER")).toBe(false);
    expect(isKindInFamily("SEAMER", "ROLLER_KNIFE")).toBe(false);
  });

  it("головной вид раздела — первый в списке и держит комплект", () => {
    expect(headKindOf("BENDER")).toBe("MACHINE");
    expect(headKindOf("SEAMER")).toBe("SEAMER");
    expect(isHeadKind("MACHINE")).toBe(true);
    expect(isHeadKind("SEAMER")).toBe(true);
    expect(isHeadKind("ROLLER_KNIFE")).toBe(false);
  });

  it("складские виды — только размотчики и частотники", () => {
    expect(isStockKind("UNCOILER")).toBe(true);
    expect(isStockKind("INVERTER")).toBe(true);
    expect(isStockKind("MACHINE")).toBe(false);
    expect(isStockKind("ROLLER_KNIFE")).toBe(false);
    expect(isStockKind("SEAMER")).toBe(false);
  });

  it("у каждого вида есть все три подписи — иначе в интерфейсе появится пустое место", () => {
    for (const family of EQUIPMENT_FAMILIES) {
      for (const kind of KINDS_BY_FAMILY[family]) {
        expect(EQUIPMENT_KIND_LABEL[kind]).toBeTruthy();
        expect(EQUIPMENT_KIND_SHORT[kind]).toBeTruthy();
        expect(EQUIPMENT_KIND_PLURAL[kind]).toBeTruthy();
      }
    }
  });
});
