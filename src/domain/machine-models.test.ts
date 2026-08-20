import { describe, it, expect } from "vitest";
import { MACHINE_MODELS, filterModelSuggestions, modelSuggestionPool } from "./machine-models";

const filter = (q: string) => filterModelSuggestions(MACHINE_MODELS, q);

describe("machine-models: подбор по части названия и разным алфавитам", () => {
  it("пустой ввод — весь список (комбобокс показывает всё по фокусу)", () => {
    expect(filter("")).toEqual([...MACHINE_MODELS]);
    expect(filter("   ")).toEqual([...MACHINE_MODELS]);
  });

  it("«лбм» кириллицей находит все Sorex LBM — и не находит LBA", () => {
    const found = filter("лбм");
    expect(found).toEqual(["Sorex LBM 200", "Sorex LBM 250", "Sorex LBM 300"]);
  });

  it("«ван» находит все Van Mark", () => {
    const found = filter("ван");
    expect(found).toEqual([
      "Van Mark MetalMaster 20 (MM)",
      "Van Mark Industrial MetalMaster (IM)",
      "Van Mark Industrial TrimMaster (IT)",
      "Van Mark II (TrimMaster)",
    ]);
  });

  it("«Профи» ищется и латиницей «profi»", () => {
    expect(filter("profi")).toEqual(["Профи 2000", "Профи 2500", "Профи 3000"]);
    expect(filter("профи")).toEqual(["Профи 2000", "Профи 2500", "Профи 3000"]);
  });

  it("«тапко» и «tapco» дают одно и то же", () => {
    const expected = ["Tapco MAX 20", "Tapco SuperMax", "Tapco Pro - 14", "Tapco Pro - 19"];
    expect(filter("tapco")).toEqual(expected);
    expect(filter("тапко")).toEqual(expected);
  });

  it("диграфы транслита: «шехтл» → Schechtl, «декер» → Decker, «сорекс» → Sorex", () => {
    expect(filter("шехтл")).toEqual(["Schechtl LBX"]);
    expect(filter("декер")).toEqual(["Decker X5", "Decker"]);
    expect(filter("сорекс")).toEqual(["Sorex LBM 200", "Sorex LBM 250", "Sorex LBM 300"]);
  });

  it("цифры ищут по вхождению: «2507» — точный размер LBA", () => {
    expect(filter("2507")).toEqual(["LBA 2507 (2.5м)"]);
    expect(filter("200")).toContain("Sorex LBM 200");
    expect(filter("200")).toContain("Профи 2000");
  });

  it("неверная раскладка чинится движком поиска: клавиши l-b-a в русской раскладке дают «диф»", () => {
    // Хотели набрать «lba», забыли переключить язык → напечаталось «диф»; конвертация раскладки находит LBA.
    expect(filter("диф")).toEqual([
      "LBA 2007 (2м)",
      "LBA 2507 (2.5м)",
      "LBA 3007 (3м)",
      "LBA 2015 (2.5м)",
      "LBA 2510 (2.5м)",
      "LBA 3010 (3м)",
    ]);
  });

  it("несуществующее — пустой список, свободному вводу это не мешает", () => {
    expect(filter("несуществующая модель")).toEqual([]);
  });
});

describe("machine-models: пул подсказок с моделями из БД", () => {
  it("базовые первыми в авторском порядке, БД-значения следом по алфавиту", () => {
    const pool = modelSuggestionPool(["Ручной листогиб", "Аякс 2М"]);
    expect(pool.slice(0, MACHINE_MODELS.length)).toEqual([...MACHINE_MODELS]);
    expect(pool.slice(MACHINE_MODELS.length)).toEqual(["Аякс 2М", "Ручной листогиб"]);
  });

  it("дубли базовых из БД отбрасываются без учёта регистра и пробелов", () => {
    const pool = modelSuggestionPool(["sorex lbm 200", "  Tapco MAX 20 ", "Decker", "Свой станок"]);
    expect(pool.filter((m) => m.toLowerCase() === "sorex lbm 200")).toHaveLength(1);
    expect(pool.filter((m) => m.toLowerCase().includes("tapco max 20"))).toHaveLength(1);
    expect(pool).toContain("Свой станок");
  });

  it("пустые и пробельные значения из БД не попадают в пул", () => {
    const pool = modelSuggestionPool(["", "   "]);
    expect(pool).toEqual([...MACHINE_MODELS]);
  });
});

// Крестик в списке подсказок (20.08.2026): в карточку иногда заносят временное название вроде
// «Хз ждём Михаила», и оно потом предлагается всем. Скрытое имя перестаёт всплывать в подсказках,
// но карточку, где оно уже записано, не трогает — это настройка подсказок, а не переименование.
describe("machine-models: скрытые модели (suppressed)", () => {
  it("скрытое БД-значение исчезает из пула, остальные остаются", () => {
    const pool = modelSuggestionPool(["Хз ждём Михаила", "Аякс 2М"], ["Хз ждём Михаила"]);
    expect(pool).not.toContain("Хз ждём Михаила");
    expect(pool).toContain("Аякс 2М");
  });

  it("скрыть можно и базовую строку справочника — раздел, где такой модели нет, её не увидит", () => {
    const pool = modelSuggestionPool([], ["Prod Masz"]);
    expect(pool).not.toContain("Prod Masz");
    expect(pool).toHaveLength(MACHINE_MODELS.length - 1);
  });

  it("сравнение без регистра и лишних пробелов — прячут по названию, а не по написанию", () => {
    const pool = modelSuggestionPool(["Свой станок"], ["  sorex LBM 200 ", "СВОЙ СТАНОК"]);
    expect(pool).not.toContain("Sorex LBM 200");
    expect(pool).not.toContain("Свой станок");
    expect(pool).toContain("Sorex LBM 250"); // соседние модели не задеты
  });

  it("пустой список скрытых — пул как без аргумента вовсе", () => {
    expect(modelSuggestionPool(["Аякс 2М"], [])).toEqual(modelSuggestionPool(["Аякс 2М"]));
  });

  it("скрытие несуществующего названия ничего не ломает", () => {
    expect(modelSuggestionPool([], ["такой модели нет"])).toEqual([...MACHINE_MODELS]);
  });

  it("скрытые модели не подставляются и в подбор по вводу", () => {
    const pool = modelSuggestionPool([], ["Sorex LBM 200"]);
    expect(filterModelSuggestions(pool, "лбм")).toEqual(["Sorex LBM 250", "Sorex LBM 300"]);
  });
});
