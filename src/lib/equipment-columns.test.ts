// Ширины колонок таблицы оборудования. Тесты держат два свойства, от которых зависит, увидит ли
// человек таблицу вообще: сумма дефолтов ровно 100 (table-fixed, ширины в процентах) и любой мусор
// в хранилище лечится дефолтом, а не пустым экраном — раскладка личная, чинить её у пользователя
// на его же ноутбуке никто не приедет.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_COL_WIDTHS,
  EQUIPMENT_COLUMNS,
  MAX_COL_PCT,
  MIN_COL_PCT,
  colsSnapshot,
  parseCols,
  resetAllCols,
  resetCol,
  saveCol,
  saveColPair,
  serverColsSnapshot,
  subscribeCols,
  visibleColWidths,
} from "./equipment-columns";

// environment: node — окна и localStorage тут нет, подставляем свой на время теста.
const store = new Map<string, string>();
let failing = false;

const localStorageStub = {
  getItem: (key: string): string | null => {
    if (failing) throw new Error("localStorage недоступен");
    return store.get(key) ?? null;
  },
  setItem: (key: string, value: string): void => {
    if (failing) throw new Error("localStorage недоступен");
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    if (failing) throw new Error("localStorage недоступен");
    store.delete(key);
  },
};

const KEY = "vanmark:equipment-cols:v1:BENDER";

beforeEach(() => {
  store.clear();
  failing = false;
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageStub },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("equipment-columns: дефолты", () => {
  it("сумма дефолтных ширин ровно 100% — иначе table-fixed уедет за край", () => {
    const total = EQUIPMENT_COLUMNS.reduce((sum, key) => sum + DEFAULT_COL_WIDTHS[key], 0);
    expect(total).toBe(100);
  });

  it("у каждой колонки из порядка есть дефолт, и лишних дефолтов нет", () => {
    expect([...EQUIPMENT_COLUMNS].sort()).toEqual(Object.keys(DEFAULT_COL_WIDTHS).sort());
  });

  it("серверный снимок — пустая раскладка: гидрация не расходится с первым рендером", () => {
    expect(parseCols(serverColsSnapshot())).toEqual(DEFAULT_COL_WIDTHS);
  });
});

describe("equipment-columns: мусор в хранилище чинится дефолтом", () => {
  it("битый JSON", () => {
    expect(parseCols("не json")).toEqual(DEFAULT_COL_WIDTHS);
  });

  it("не объект", () => {
    expect(parseCols("null")).toEqual(DEFAULT_COL_WIDTHS);
    expect(parseCols("42")).toEqual(DEFAULT_COL_WIDTHS);
  });

  it("отсутствующие ключи — колонка едет за дефолтом", () => {
    expect(parseCols('{"model":40}')).toEqual({ ...DEFAULT_COL_WIDTHS, model: 40 });
  });

  it("лишние ключи от прошлых версий просто игнорируются", () => {
    expect(parseCols('{"model":40,"geo":15}')).toEqual({ ...DEFAULT_COL_WIDTHS, model: 40 });
  });

  it("не-числа", () => {
    expect(parseCols('{"model":"40","status":null,"price":true}')).toEqual(DEFAULT_COL_WIDTHS);
  });

  it("NaN и бесконечность (в хранилище попадают как null/строка)", () => {
    expect(parseCols(JSON.stringify({ model: Number.NaN, status: Number.POSITIVE_INFINITY }))).toEqual(
      DEFAULT_COL_WIDTHS,
    );
    expect(parseCols('{"model":"NaN"}')).toEqual(DEFAULT_COL_WIDTHS);
  });

  it("ширины вне диапазона — колонку не спрятать и не раздуть на весь экран", () => {
    expect(parseCols(JSON.stringify({ number: MIN_COL_PCT - 1, model: MAX_COL_PCT + 1 }))).toEqual(
      DEFAULT_COL_WIDTHS,
    );
    expect(parseCols('{"number":0,"model":-30}')).toEqual(DEFAULT_COL_WIDTHS);
  });

  it("границы диапазона остаются как есть", () => {
    expect(parseCols(JSON.stringify({ number: MIN_COL_PCT, model: MAX_COL_PCT }))).toEqual({
      ...DEFAULT_COL_WIDTHS,
      number: MIN_COL_PCT,
      model: MAX_COL_PCT,
    });
  });
});

describe("equipment-columns: сохранение", () => {
  it("сохранённая ширина читается обратно", () => {
    saveCol("BENDER", "model", 42);
    expect(parseCols(colsSnapshot("BENDER"))).toEqual({ ...DEFAULT_COL_WIDTHS, model: 42 });
  });

  it("в хранилище лежат только изменённые колонки", () => {
    saveCol("BENDER", "model", 42);
    expect(JSON.parse(store.get(KEY) ?? "{}")).toEqual({ model: 42 });
  });

  it("раздел от раздела не зависит — у каждого своя запись", () => {
    saveCol("BENDER", "model", 42);
    expect(parseCols(colsSnapshot("FOLDER"))).toEqual(DEFAULT_COL_WIDTHS);
  });

  it("перетаскивание за границу подрезается, а не отбрасывается", () => {
    saveCol("BENDER", "number", 1);
    saveCol("BENDER", "model", 95);
    expect(parseCols(colsSnapshot("BENDER"))).toEqual({
      ...DEFAULT_COL_WIDTHS,
      number: MIN_COL_PCT,
      model: MAX_COL_PCT,
    });
  });

  it("хвосты float от мыши не копятся в хранилище", () => {
    saveCol("BENDER", "model", 30.000000000004);
    expect(JSON.parse(store.get(KEY) ?? "{}")).toEqual({ model: 30 });
  });

  it("NaN не пишется — иначе колонка исчезнет", () => {
    saveCol("BENDER", "model", Number.NaN);
    expect(store.has(KEY)).toBe(false);
  });

  it("подписчиков оповещают: соседние открытые экраны перерисовываются", () => {
    let calls = 0;
    const unsubscribe = subscribeCols(() => {
      calls += 1;
    });
    saveCol("BENDER", "model", 42);
    resetCol("BENDER", "model");
    resetAllCols("BENDER");
    unsubscribe();
    saveCol("BENDER", "model", 20);
    expect(calls).toBe(3);
  });
});

describe("equipment-columns: сброс", () => {
  it("сброс одной колонки не трогает соседние", () => {
    saveCol("BENDER", "model", 42);
    saveCol("BENDER", "status", 12);
    resetCol("BENDER", "model");
    expect(parseCols(colsSnapshot("BENDER"))).toEqual({ ...DEFAULT_COL_WIDTHS, status: 12 });
  });

  it("сброс последней колонки стирает запись целиком", () => {
    saveCol("BENDER", "model", 42);
    resetCol("BENDER", "model");
    expect(store.has(KEY)).toBe(false);
  });

  it("сброс всех колонок стирает запись целиком", () => {
    saveCol("BENDER", "model", 42);
    saveCol("BENDER", "status", 12);
    resetAllCols("BENDER");
    expect(store.has(KEY)).toBe(false);
    expect(parseCols(colsSnapshot("BENDER"))).toEqual(DEFAULT_COL_WIDTHS);
  });
});

describe("equipment-columns: недоступный localStorage", () => {
  it("приватный режим не роняет экран — раскладка по умолчанию", () => {
    failing = true;
    expect(colsSnapshot("BENDER")).toBe(serverColsSnapshot());
    expect(() => saveCol("BENDER", "model", 42)).not.toThrow();
    expect(() => resetAllCols("BENDER")).not.toThrow();
  });
});

describe("equipment-columns: перетаскивание границы (пара колонок)", () => {
  it("сколько забрали у соседа, столько отдали левой колонке — сумма не меняется", () => {
    const before = DEFAULT_COL_WIDTHS.model + DEFAULT_COL_WIDTHS.status;
    saveColPair("BENDER", { key: "model", pct: 38 }, { key: "status", pct: before - 38 });
    const widths = parseCols(colsSnapshot("BENDER"));
    expect(widths.model).toBe(38);
    expect(widths.model + widths.status).toBeCloseTo(before, 5);
  });

  it("пара пишется одной записью, а не двумя — промежуточного состояния в хранилище нет", () => {
    saveColPair("BENDER", { key: "price", pct: 15 }, { key: "thickness", pct: 7 });
    expect(JSON.parse(store.get(KEY) ?? "{}")).toEqual({ price: 15, thickness: 7 });
  });

  it("нечисловые значения игнорируются целиком: половину пары записать нельзя", () => {
    saveColPair("BENDER", { key: "model", pct: Number.NaN }, { key: "status", pct: 20 });
    expect(store.has(KEY)).toBe(false);
  });

  it("двойной щелчок возвращает обе колонки границы", () => {
    saveColPair("BENDER", { key: "model", pct: 45 }, { key: "status", pct: 9 });
    resetCol("BENDER", "model", "status");
    expect(parseCols(colsSnapshot("BENDER"))).toEqual(DEFAULT_COL_WIDTHS);
  });
});

describe("equipment-columns: нормализация видимых колонок", () => {
  it("без колонки «Срок» доли всё равно дают в сумме сотню", () => {
    const visible = EQUIPMENT_COLUMNS.filter((k) => k !== "due");
    const shares = visibleColWidths(DEFAULT_COL_WIDTHS, visible);
    const sum = visible.reduce((acc, k) => acc + shares[k], 0);
    expect(sum).toBeCloseTo(100, 5);
    // Пропорции сохраняются: «Модель» относилась к «Состоянию» как 30 к 24 — так и осталось.
    expect(shares.model / shares.status).toBeCloseTo(
      DEFAULT_COL_WIDTHS.model / DEFAULT_COL_WIDTHS.status,
      5,
    );
  });

  it("когда видны все колонки, доли совпадают с сохранёнными", () => {
    const shares = visibleColWidths(DEFAULT_COL_WIDTHS, EQUIPMENT_COLUMNS);
    for (const key of EQUIPMENT_COLUMNS) expect(shares[key]).toBeCloseTo(DEFAULT_COL_WIDTHS[key], 5);
  });

  it("пустой набор видимых колонок не роняет расчёт", () => {
    expect(visibleColWidths(DEFAULT_COL_WIDTHS, [])).toEqual({});
  });
});
