// Вид списка оборудования (решение Артёма 15.08.2026): «нужна возможность вариаций группировки и
// вариаций изменения порядка». Тесты фиксируют главное свойство — порядок ПРЕДСКАЗУЕМ: приходит с
// сервера по учётному номеру, а вид его только раскладывает. Именно непредсказуемость (сортировка
// по дате изменения) и была жалобой: «при открытии заявки она вылетает наверх».
import { describe, it, expect } from "vitest";
import { applyView, parseView } from "./equipment-view";
import type { MachineListItem } from "./machine-dto";

const item = (over: Partial<MachineListItem>): MachineListItem =>
  ({
    id: String(over.ourNumber ?? Math.random()),
    number: 1,
    ourNumber: null,
    family: "BENDER",
    kind: "MACHINE",
    quantity: 1,
    freeQuantity: 1,
    kitParts: [],
    kitHeads: [],
    category: "OUR_SALE",
    status: "READY",
    model: "Sorex LBM 200",
    ...over,
  }) as MachineListItem;

const list = [
  item({ ourNumber: 1, status: "NEEDS_REPAIR" }),
  item({ ourNumber: 2, status: "READY" }),
  item({ ourNumber: 3, status: "NEEDS_REPAIR" }),
];

const numbers = (groups: ReturnType<typeof applyView>): number[][] =>
  groups.map((g) => g.items.map((i) => i.ourNumber ?? 0));

describe("equipment-view: порядок", () => {
  it("без группировки список идёт как пришёл", () => {
    const groups = applyView(list, { groupBy: "none", direction: "asc" });
    expect(numbers(groups)).toEqual([[1, 2, 3]]);
    expect(groups[0].title).toBeNull();
  });

  it("«с конца» переворачивает список целиком", () => {
    expect(numbers(applyView(list, { groupBy: "none", direction: "desc" }))).toEqual([[3, 2, 1]]);
  });

  it("исходный массив не мутируется — SWR отдаёт его же в следующий рендер", () => {
    applyView(list, { groupBy: "none", direction: "desc" });
    expect(list.map((i) => i.ourNumber)).toEqual([1, 2, 3]);
  });
});

describe("equipment-view: группировка", () => {
  it("группы идут в порядке жизненного цикла, а не алфавита", () => {
    const groups = applyView(list, { groupBy: "status", direction: "asc" });
    expect(groups.map((g) => g.title)).toEqual(["Требует ремонта", "Готов"]);
    expect(numbers(groups)).toEqual([[1, 3], [2]]);
  });

  it("направление действует и внутри групп", () => {
    const groups = applyView(list, { groupBy: "status", direction: "desc" });
    expect(numbers(groups)).toEqual([[3, 1], [2]]);
  });

  it("группировка по виду подписана множественным числом — как плашки раздела", () => {
    const mixed = [item({ ourNumber: 1 }), item({ ourNumber: 2, kind: "ROLLER_KNIFE" })];
    const groups = applyView(mixed, { groupBy: "kind", direction: "asc" });
    expect(groups.map((g) => g.title)).toEqual(["Листогибы", "Ножи"]);
  });
});

describe("equipment-view: чтение сохранённой настройки", () => {
  it("мусор из хранилища не ломает экран", () => {
    expect(parseView("не json")).toEqual({ groupBy: "none", direction: "asc" });
    expect(parseView("null")).toEqual({ groupBy: "none", direction: "asc" });
    expect(parseView('{"groupBy":"по-старому","direction":"вверх"}')).toEqual({
      groupBy: "none",
      direction: "asc",
    });
  });

  it("сохранённый вид читается обратно", () => {
    expect(parseView('{"groupBy":"status","direction":"desc"}')).toEqual({
      groupBy: "status",
      direction: "desc",
    });
  });
});
