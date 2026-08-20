import { describe, it, expect } from "vitest";
import {
  configurationOptionsFor,
  joinConfiguration,
  splitConfiguration,
  CONFIGURATION_OPTIONS,
} from "./machine-configuration";

describe("machine-configuration: пункты вида", () => {
  it("галочки есть у головных видов и нет у ножей и складских позиций", () => {
    expect(configurationOptionsFor("MACHINE")).toEqual(["Роликовый нож", "Машинка", "Стойка"]);
    expect(configurationOptionsFor("SEAMER")).toEqual(["Размотчик", "Частотник"]);
    expect(configurationOptionsFor("ROLLER_KNIFE")).toEqual([]);
    expect(configurationOptionsFor("UNCOILER")).toEqual([]);
    expect(configurationOptionsFor("INVERTER")).toEqual([]);
  });
});

describe("machine-configuration: разбор строки в галочки", () => {
  it("пустая строка и NULL дают пустую форму", () => {
    expect(splitConfiguration("MACHINE", null)).toEqual({ selected: [], custom: "" });
    expect(splitConfiguration("MACHINE", "")).toEqual({ selected: [], custom: "" });
    expect(splitConfiguration("MACHINE", "  ,  , ")).toEqual({ selected: [], custom: "" });
  });

  it("узнаёт пункт при любом регистре и лишних пробелах, кладёт каноническое написание", () => {
    expect(splitConfiguration("MACHINE", "  роликовый   НОЖ ,машинка")).toEqual({
      selected: ["Роликовый нож", "Машинка"],
      custom: "",
    });
  });

  it("порядок галочек канонический, а не как во входной строке", () => {
    expect(splitConfiguration("MACHINE", "Стойка, Роликовый нож").selected).toEqual([
      "Роликовый нож",
      "Стойка",
    ]);
  });

  it("дубликаты пункта схлопываются в одну галочку", () => {
    expect(splitConfiguration("MACHINE", "Машинка, машинка, МАШИНКА")).toEqual({
      selected: ["Машинка"],
      custom: "",
    });
  });

  it("неизвестное уходит в «своё» поле, сохраняя порядок и написание", () => {
    expect(splitConfiguration("MACHINE", "короб, Стойка, ЗАПАСНОЙ вал, роликовый нож")).toEqual({
      selected: ["Роликовый нож", "Стойка"],
      custom: "короб, ЗАПАСНОЙ вал",
    });
  });

  it("у вида без галочек вся строка целиком остаётся текстом", () => {
    // «Машинка» — пункт листогиба, у ножа она пунктом не является и в галочку не превращается.
    expect(splitConfiguration("ROLLER_KNIFE", "Машинка, две обоймы")).toEqual({
      selected: [],
      custom: "Машинка, две обоймы",
    });
  });

  it("пункты соседнего вида не подхватываются: у каждого раздела свой список", () => {
    expect(splitConfiguration("SEAMER", "Стойка, Частотник")).toEqual({
      selected: ["Частотник"],
      custom: "Стойка",
    });
  });
});

describe("machine-configuration: сборка строки для БД", () => {
  it("собирает пункты в каноническом порядке, «своё» — в хвосте", () => {
    expect(joinConfiguration("MACHINE", ["Стойка", "Роликовый нож"], " короб ")).toBe(
      "Роликовый нож, Стойка, короб",
    );
  });

  it("пустые части не попадают в строку", () => {
    expect(joinConfiguration("MACHINE", [], "")).toBe("");
    expect(joinConfiguration("MACHINE", [], "   ")).toBe("");
    expect(joinConfiguration("MACHINE", ["Машинка"], "  ")).toBe("Машинка");
    expect(joinConfiguration("MACHINE", [], "короб")).toBe("короб");
  });

  it("чужие для вида пункты отбрасываются", () => {
    // Такое приходит из формы после смены вида: галочки листогиба остались в состоянии.
    expect(joinConfiguration("SEAMER", ["Машинка", "Частотник"], "")).toBe("Частотник");
    expect(joinConfiguration("ROLLER_KNIFE", ["Машинка", "Стойка"], "две обоймы")).toBe(
      "две обоймы",
    );
  });

  it("дубликаты в selected не удваивают пункт в строке", () => {
    expect(joinConfiguration("MACHINE", ["Машинка", "машинка"], "")).toBe("Машинка");
  });
});

// Главное свойство модуля: строка в БД одна, а формы её открывают и сохраняют многократно —
// значит разбор и сборка обязаны сходиться, иначе комплектация будет медленно портиться от правок.
describe("machine-configuration: round-trip", () => {
  const SUBSETS: readonly (readonly string[])[] = [
    [],
    ["Машинка"],
    ["Стойка", "Роликовый нож"],
    ["Роликовый нож", "Машинка", "Стойка"],
  ];
  // «Своё» без известных пунктов внутри — иначе оно по смыслу превратится в галочку.
  const CUSTOMS = ["", "   ", "короб", "две стойки, ящик инструмента"];

  it("split(join(selected, custom)) возвращает те же галочки и тот же хвост", () => {
    for (const selected of SUBSETS) {
      for (const custom of CUSTOMS) {
        const raw = joinConfiguration("MACHINE", selected, custom);
        const back = splitConfiguration("MACHINE", raw);
        const expected = configurationOptionsFor("MACHINE").filter((o) => selected.includes(o));
        expect(back.selected, raw).toEqual(expected);
        expect(back.custom, raw).toBe(custom.trim());
      }
    }
  });

  it("повторное открытие и сохранение карточки больше ничего не меняет", () => {
    const raws = [
      "стойка,роликовый  НОЖ, короб",
      "короб, Машинка, короб",
      "Машинка",
      "",
      " , ",
    ];
    for (const raw of raws) {
      const first = splitConfiguration("MACHINE", raw);
      const stored = joinConfiguration("MACHINE", first.selected, first.custom);
      expect(splitConfiguration("MACHINE", stored), raw).toEqual(first);
      // Второе сохранение даёт байт в байт ту же строку — правка «ничего не менял» не создаёт диффа.
      expect(joinConfiguration("MACHINE", first.selected, first.custom), raw).toBe(stored);
    }
  });

  it("у вида без галочек текст переживает round-trip дословно", () => {
    const raw = "Машинка, две обоймы";
    const parts = splitConfiguration("ROLLER_KNIFE", raw);
    expect(joinConfiguration("ROLLER_KNIFE", parts.selected, parts.custom)).toBe(raw);
  });
});

describe("machine-configuration: справочник пунктов", () => {
  it("пункты не дублируются внутри вида", () => {
    for (const options of Object.values(CONFIGURATION_OPTIONS)) {
      const keys = options.map((o) => o.trim().toLowerCase());
      expect(new Set(keys).size).toBe(options.length);
    }
  });
});
