import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_FAMILIES,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_PLURAL,
  EQUIPMENT_KIND_SHORT,
  KINDS_BY_FAMILY,
  MACHINE_CATEGORIES,
  MACHINE_STATUSES,
  SELECTABLE_MACHINE_STATUSES,
  STOCK_CATEGORIES,
  categoriesFollowingStatus,
  categoriesForStatus,
  categoriesLabel,
  selectableStatuses,
  familyOfKind,
  headKindOf,
  isArchivedStatus,
  isHeadKind,
  isKindInFamily,
  isOurCategories,
  isRetiredStatus,
  isStatusAllowedForCategories,
  isStockKind,
  isValidCategorySet,
  normalizeCategories,
  reasonRequiredFor,
  statusesForCategories,
  MACHINE_STATUS_LABEL,
  MACHINE_CATEGORY_LABEL,
} from "./machine-status";
import type { MachineCategory, MachineStatus } from "@/generated/prisma/enums";

// Оба «наших» назначения сразу: станок стоит на площадке и под продажу, и под аренду
// (решение Артёма 20.08.2026). Самый интересный набор — он проверяется чаще прочих.
const BOTH: MachineCategory[] = ["OUR_SALE", "OUR_RENTAL"];

describe("machine-status: набор категорий", () => {
  it("нормализация приводит набор к каноническому порядку без дублей", () => {
    // Порядок галочек в форме случайный, а в журнал «было→стало» и в ключ группы попадает строка —
    // без нормализации один и тот же станок выглядел бы то так, то эдак.
    expect(normalizeCategories(["OUR_RENTAL", "OUR_SALE"])).toEqual(["OUR_SALE", "OUR_RENTAL"]);
    expect(normalizeCategories(["OUR_SALE", "OUR_SALE"])).toEqual(["OUR_SALE"]);
    expect(normalizeCategories(["OUR_RENTAL", "CLIENT", "OUR_SALE"])).toEqual([
      "CLIENT",
      "OUR_SALE",
      "OUR_RENTAL",
    ]);
    expect(normalizeCategories([])).toEqual([]);
  });

  it("одиночные категории допустимы все три", () => {
    for (const c of MACHINE_CATEGORIES) expect(isValidCategorySet([c])).toBe(true);
  });

  it("пустой набор недопустим — станок всегда чей-то", () => {
    expect(isValidCategorySet([])).toBe(false);
  });

  it("«Клиентский» ни с чем не совмещается — чужое железо остаётся чужим", () => {
    expect(isValidCategorySet(["CLIENT", "OUR_SALE"])).toBe(false);
    expect(isValidCategorySet(["CLIENT", "OUR_RENTAL"])).toBe(false);
    expect(isValidCategorySet(["CLIENT", "OUR_SALE", "OUR_RENTAL"])).toBe(false);
  });

  it("«на продажу» + «арендный» — единственная допустимая пара", () => {
    expect(isValidCategorySet(BOTH)).toBe(true);
    expect(isValidCategorySet(["OUR_RENTAL", "OUR_SALE"])).toBe(true); // порядок не важен
  });

  it("наш станок — тот, в наборе которого нет «Клиентского» (ему положен номер 77-N)", () => {
    expect(isOurCategories(["OUR_SALE"])).toBe(true);
    expect(isOurCategories(["OUR_RENTAL"])).toBe(true);
    expect(isOurCategories(BOTH)).toBe(true);
    expect(isOurCategories(["CLIENT"])).toBe(false);
  });

  it("подпись набора — через « + », в каноническом порядке", () => {
    expect(categoriesLabel(["OUR_SALE"])).toBe("Наш на продажу");
    expect(categoriesLabel(BOTH)).toBe("Наш на продажу + Наш арендный");
    expect(categoriesLabel(["OUR_RENTAL", "OUR_SALE"])).toBe("Наш на продажу + Наш арендный");
    expect(categoriesLabel(["CLIENT"])).toBe("Клиентский");
  });

  it("пустой набор подписывается прочерком, а не пустой строкой", () => {
    expect(categoriesLabel([])).toBe("—");
  });
});

describe("machine-status: совместимость состояния и категорий", () => {
  it("«В аренде» требует «Наш арендный» В НАБОРЕ", () => {
    expect(isStatusAllowedForCategories(["OUR_RENTAL"], "RENTED")).toBe(true);
    expect(isStatusAllowedForCategories(BOTH, "RENTED")).toBe(true); // категория есть в наборе
    expect(isStatusAllowedForCategories(["OUR_SALE"], "RENTED")).toBe(false);
    expect(isStatusAllowedForCategories(["CLIENT"], "RENTED")).toBe(false);
  });

  it("«Продан» требует «Наш на продажу» В НАБОРЕ", () => {
    expect(isStatusAllowedForCategories(["OUR_SALE"], "SOLD")).toBe(true);
    expect(isStatusAllowedForCategories(BOTH, "SOLD")).toBe(true);
    expect(isStatusAllowedForCategories(["OUR_RENTAL"], "SOLD")).toBe(false);
    expect(isStatusAllowedForCategories(["CLIENT"], "SOLD")).toBe(false);
  });

  it("«Выдан клиенту» — только у клиентского", () => {
    expect(isStatusAllowedForCategories(["CLIENT"], "RELEASED")).toBe(true);
    expect(isStatusAllowedForCategories(["OUR_SALE"], "RELEASED")).toBe(false);
    expect(isStatusAllowedForCategories(["OUR_RENTAL"], "RELEASED")).toBe(false);
    expect(isStatusAllowedForCategories(BOTH, "RELEASED")).toBe(false);
  });

  it("рабочие состояния допустимы при любых категориях", () => {
    const free: MachineStatus[] = ["ACCEPTED", "NEEDS_REPAIR", "IN_REPAIR", "READY", "VOIDED"];
    const sets: MachineCategory[][] = [["CLIENT"], ["OUR_SALE"], ["OUR_RENTAL"], BOTH];
    for (const set of sets) {
      for (const status of free) {
        expect(isStatusAllowedForCategories(set, status)).toBe(true);
      }
    }
  });

  it("каждая пара «набор × состояние» имеет однозначный вердикт", () => {
    const sets: MachineCategory[][] = [["CLIENT"], ["OUR_SALE"], ["OUR_RENTAL"], BOTH];
    const pairs: [string, MachineStatus, boolean][] = [];
    for (const set of sets) {
      for (const s of MACHINE_STATUSES) {
        pairs.push([set.join("+"), s, isStatusAllowedForCategories(set, s)]);
      }
    }
    // 4 набора × 8 состояний. Запрещены 7 пар: у клиентского SOLD+RENTED, у «на продажу»
    // RENTED+RELEASED, у «арендного» SOLD+RELEASED, у двойного — только RELEASED.
    expect(pairs).toHaveLength(32);
    expect(pairs.filter(([, , ok]) => !ok)).toHaveLength(7);
  });

  it("statusesForCategories не предлагает заведомо неверное", () => {
    expect(statusesForCategories(["CLIENT"])).not.toContain("SOLD");
    expect(statusesForCategories(["CLIENT"])).not.toContain("RENTED");
    expect(statusesForCategories(["CLIENT"])).toContain("RELEASED");
    expect(statusesForCategories(["OUR_RENTAL"])).toContain("RENTED");
    expect(statusesForCategories(["OUR_RENTAL"])).not.toContain("SOLD"); // строгий инвариант
    expect(statusesForCategories(["OUR_SALE"])).toContain("SOLD");
    expect(statusesForCategories(BOTH)).toEqual(
      expect.arrayContaining(["SOLD", "RENTED"] as MachineStatus[]),
    );
  });

  it("categoriesForStatus — обратная подсказка при смене категорий", () => {
    expect(categoriesForStatus("RENTED")).toEqual(["OUR_RENTAL"]);
    expect(categoriesForStatus("SOLD")).toEqual(["OUR_SALE"]);
    expect(categoriesForStatus("READY")).toEqual(["CLIENT", "OUR_SALE", "OUR_RENTAL"]);
  });
});

describe("machine-status: «Принят» выведен из оборота (20.08.2026)", () => {
  it("«Принят» — единственное выведенное состояние", () => {
    expect(isRetiredStatus("ACCEPTED")).toBe(true);
    for (const s of MACHINE_STATUSES.filter((x) => x !== "ACCEPTED")) {
      expect(isRetiredStatus(s)).toBe(false);
    }
  });

  it("выбрать «Принят» больше нельзя нигде", () => {
    expect(SELECTABLE_MACHINE_STATUSES).not.toContain("ACCEPTED");
    for (const set of [["CLIENT"], ["OUR_SALE"], ["OUR_RENTAL"], BOTH] as MachineCategory[][]) {
      expect(statusesForCategories(set)).not.toContain("ACCEPTED");
      expect(selectableStatuses(set)).not.toContain("ACCEPTED");
    }
  });

  it("подпись «Принят» осталась — на неё ссылается история карточки", () => {
    // Значение не убрано из enum: старые события MachineEvent должны читаться словами, а не кодом.
    expect(MACHINE_STATUSES).toContain("ACCEPTED");
    expect(MACHINE_STATUS_LABEL.ACCEPTED).toBe("Принят");
  });

  it("выведенное состояние остаётся рабочим по смыслу: оно не архив и не требует причины", () => {
    expect(isArchivedStatus("ACCEPTED")).toBe(false);
    expect(reasonRequiredFor("ACCEPTED")).toBe(false);
  });
});

describe("machine-status: кнопки состояний в карточке (15.08.2026)", () => {
  it("у своего железа кнопками доступны и «Продан», и «В аренде»", () => {
    for (const our of [["OUR_SALE"], ["OUR_RENTAL"], BOTH] as MachineCategory[][]) {
      expect(selectableStatuses(our)).toContain("SOLD");
      expect(selectableStatuses(our)).toContain("RENTED");
      expect(selectableStatuses(our)).not.toContain("RELEASED"); // выдают только чужое
    }
  });

  it("у клиентского — только «Выдан клиенту»: чужой станок не продают и не сдают", () => {
    expect(selectableStatuses(["CLIENT"])).toContain("RELEASED");
    expect(selectableStatuses(["CLIENT"])).not.toContain("SOLD");
    expect(selectableStatuses(["CLIENT"])).not.toContain("RENTED");
  });

  it("порядок кнопок — порядок жизненного цикла, без дублей", () => {
    const list = selectableStatuses(["OUR_SALE"]);
    expect(list).toEqual([...new Set(list)]);
    expect(list.indexOf("READY")).toBeLessThan(list.indexOf("SOLD"));
    expect(list.at(-1)).toBe("VOIDED"); // аннулирование — всегда последним
  });
});

describe("machine-status: категория едет за состоянием (ДОБАВЛЯЕТСЯ, не заменяет)", () => {
  it("сдали в аренду станок с продажи — он и арендный, и по-прежнему продаётся", () => {
    // Ключевая правка 20.08.2026: раньше вторая категория затиралась, и станок «терял» назначение,
    // с которым его заводили. Из аренды он вернётся и снова будет ждать покупателя.
    expect(categoriesFollowingStatus(["OUR_SALE"], "RENTED")).toEqual(["OUR_SALE", "OUR_RENTAL"]);
  });

  it("продали арендный — «на продажу» добавляется к аренде", () => {
    expect(categoriesFollowingStatus(["OUR_RENTAL"], "SOLD")).toEqual(["OUR_SALE", "OUR_RENTAL"]);
  });

  it("результат нормализован — порядок категорий не зависит от того, что добавляли", () => {
    expect(categoriesFollowingStatus(["OUR_RENTAL"], "SOLD")).toEqual(
      categoriesFollowingStatus(["OUR_SALE"], "RENTED"),
    );
  });

  it("менять нечего, когда состояние и так подходит", () => {
    expect(categoriesFollowingStatus(["OUR_SALE"], "SOLD")).toBeNull();
    expect(categoriesFollowingStatus(["OUR_RENTAL"], "READY")).toBeNull();
    expect(categoriesFollowingStatus(["CLIENT"], "RELEASED")).toBeNull();
    expect(categoriesFollowingStatus(BOTH, "SOLD")).toBeNull(); // обе категории уже на месте
    expect(categoriesFollowingStatus(BOTH, "RENTED")).toBeNull();
  });

  it("клиентский станок не переезжает в наши категории сам", () => {
    // Для чужого железа несовместимость — настоящая ошибка ввода, а не смена планов.
    expect(categoriesFollowingStatus(["CLIENT"], "SOLD")).toBeNull();
    expect(categoriesFollowingStatus(["CLIENT"], "RENTED")).toBeNull();
  });

  it("«Выдан клиенту» не делает наш станок клиентским", () => {
    expect(categoriesFollowingStatus(["OUR_SALE"], "RELEASED")).toBeNull();
    expect(categoriesFollowingStatus(["OUR_RENTAL"], "RELEASED")).toBeNull();
    expect(categoriesFollowingStatus(BOTH, "RELEASED")).toBeNull();
  });

  it("после переезда состояние становится допустимым — кнопка не оставляет карточку сломанной", () => {
    for (const [from, status] of [
      [["OUR_SALE"], "RENTED"],
      [["OUR_RENTAL"], "SOLD"],
    ] as [MachineCategory[], MachineStatus][]) {
      const next = categoriesFollowingStatus(from, status);
      expect(next).not.toBeNull();
      expect(isValidCategorySet(next ?? [])).toBe(true);
      expect(isStatusAllowedForCategories(next ?? [], status)).toBe(true);
    }
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
    for (const s of ["NEEDS_REPAIR", "IN_REPAIR", "READY"] as MachineStatus[]) {
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

describe("machine-status: подписи", () => {
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
    expect(isKindInFamily("SEAMER", "FALZ_MACHINE")).toBe(false);
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

  it("складским позициям положена фиксированная категория — «наш на продажу», списком", () => {
    expect([...STOCK_CATEGORIES]).toEqual(["OUR_SALE"]);
    expect(isValidCategorySet(STOCK_CATEGORIES)).toBe(true);
  });
});

describe("machine-status: фальц машинка (новый вид листогибов)", () => {
  it("живёт в разделе листогибов, третьим видом", () => {
    expect(familyOfKind("FALZ_MACHINE")).toBe("BENDER");
    expect(isKindInFamily("BENDER", "FALZ_MACHINE")).toBe(true);
    expect(KINDS_BY_FAMILY.BENDER).toEqual(["MACHINE", "ROLLER_KNIFE", "FALZ_MACHINE"]);
  });

  it("не головная и не складская: штучная комплектующая листогиба", () => {
    // Головной вид держит комплект, складской ведётся количеством — машинка ни то, ни другое:
    // она едет в комплекте с листогибом, но учитывается поштучно, как нож.
    expect(isHeadKind("FALZ_MACHINE")).toBe(false);
    expect(isStockKind("FALZ_MACHINE")).toBe(false);
  });

  it("подписан всеми тремя формами", () => {
    expect(EQUIPMENT_KIND_LABEL.FALZ_MACHINE).toBe("Фальц машинка");
    expect(EQUIPMENT_KIND_SHORT.FALZ_MACHINE).toBe("Машинка");
    expect(EQUIPMENT_KIND_PLURAL.FALZ_MACHINE).toBe("Фальц машинки");
  });
});
