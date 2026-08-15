// Комплектация (решение Артёма 15.08.2026). Тесты фиксируют ГРАНИЦЫ двух механик: уникальный
// экземпляр (нож) — ровно один комплект; складская позиция (размотчик) — много комплектов, но
// суммарно не больше остатка. Именно на этой границе живут ошибки «один размотчик уехал трижды».
import { describe, it, expect } from "vitest";
import { assertAttachable, consumesStock, freeStock, stockUsage, transfersStatus } from "./machine-kit";
import type { KitSide } from "./machine-kit";

const bender: KitSide = { id: "m1", family: "BENDER", kind: "MACHINE", quantity: 1 };
const knife: KitSide = { id: "k1", family: "BENDER", kind: "ROLLER_KNIFE", quantity: 1 };
const seamer: KitSide = { id: "s1", family: "SEAMER", kind: "SEAMER", quantity: 1 };
const uncoiler: KitSide = { id: "u1", family: "SEAMER", kind: "UNCOILER", quantity: 5 };

const err = (fn: () => void): string => {
  try {
    fn();
    return "";
  } catch (e) {
    return (e as { message: string }).message;
  }
};

describe("machine-kit: остаток складской позиции", () => {
  it("занятым считается всё, что стоит в комплектах, а не только уехавшее", () => {
    const links = [{ qty: 2, consumedAt: null }];
    expect(freeStock(5, links)).toBe(3);
  });

  it("списанное не вычитается второй раз: продажа уже уменьшила quantity", () => {
    const links = [
      { qty: 2, consumedAt: new Date() },
      { qty: 1, consumedAt: null },
    ];
    expect(stockUsage(links)).toBe(1);
    expect(freeStock(3, links)).toBe(2);
  });

  it("остаток не уходит в минус даже при рассогласовании данных", () => {
    expect(freeStock(1, [{ qty: 4, consumedAt: null }])).toBe(0);
  });
});

describe("machine-kit: что можно поставить в комплект", () => {
  it("нож встаёт к листогибу", () => {
    expect(err(() => assertAttachable(bender, knife, 1, []))).toBe("");
  });

  it("нож из другого комплекта не берётся повторно", () => {
    const msg = err(() => assertAttachable(bender, knife, 1, [{ qty: 1, consumedAt: null }]));
    expect(msg).toContain("уже стоит в другом комплекте");
  });

  it("нож, уехавший в проданном комплекте, освобождает место (карточка вернулась)", () => {
    expect(err(() => assertAttachable(bender, knife, 1, [{ qty: 1, consumedAt: new Date() }]))).toBe("");
  });

  it("комплектующая другого раздела отклоняется", () => {
    expect(err(() => assertAttachable(bender, uncoiler, 1, []))).toContain("другого раздела");
  });

  it("второй станок в комплект не кладётся", () => {
    expect(err(() => assertAttachable(bender, { ...seamer, family: "BENDER" }, 1, []))).toContain(
      "не второй станок",
    );
  });

  it("комплект собирается только у станка, а не у комплектующей", () => {
    expect(err(() => assertAttachable(knife, bender, 1, []))).toContain("только у станка");
  });

  it("сам к себе станок не добавляется", () => {
    expect(err(() => assertAttachable(bender, bender, 1, []))).toContain("сам к себе");
  });

  it("складская позиция берётся количеством в пределах свободного остатка", () => {
    expect(err(() => assertAttachable(seamer, uncoiler, 3, []))).toBe("");
    expect(err(() => assertAttachable(seamer, uncoiler, 3, [{ qty: 3, consumedAt: null }]))).toContain(
      "Свободно только 2",
    );
  });

  it("когда свободных штук нет, говорим это прямо", () => {
    const msg = err(() => assertAttachable(seamer, uncoiler, 1, [{ qty: 5, consumedAt: null }]));
    expect(msg).toBe("Свободных штук не осталось");
  });

  it("нулевое и дробное количество не принимается", () => {
    expect(err(() => assertAttachable(seamer, uncoiler, 0, []))).toContain("целое число от 1");
    expect(err(() => assertAttachable(seamer, uncoiler, 1.5, []))).toContain("целое число от 1");
  });
});

describe("machine-kit: что происходит с комплектом при смене состояния", () => {
  it("состояние переносится на комплект, кроме аннулирования", () => {
    expect(transfersStatus("SOLD")).toBe(true);
    expect(transfersStatus("IN_REPAIR")).toBe(true);
    expect(transfersStatus("RENTED")).toBe(true);
    // Ошибочная карточка станка не делает ошибочными карточки его ножей.
    expect(transfersStatus("VOIDED")).toBe(false);
  });

  it("склад списывается только когда железо уехало насовсем", () => {
    expect(consumesStock("SOLD")).toBe(true);
    expect(consumesStock("RELEASED")).toBe(true);
    // Аренда возвращается в цикл — штуки заняты резервом, но не списаны.
    expect(consumesStock("RENTED")).toBe(false);
    expect(consumesStock("IN_REPAIR")).toBe(false);
  });
});
