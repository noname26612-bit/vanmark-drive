import { describe, it, expect } from "vitest";
import {
  formatMachineNumber,
  formatNumberIn,
  machineNumberSearchVariants,
  machineNumberValue,
  numberFieldFor,
  numberSchemeFor,
} from "./machine-number";

describe("machine-number: схема нумерации по происхождению", () => {
  it("своё железо нумеруется «77-N», чужое — «К-N»", () => {
    expect(numberSchemeFor("OUR_SALE")).toBe("OUR");
    expect(numberSchemeFor("OUR_RENTAL")).toBe("OUR");
    expect(numberSchemeFor("CLIENT")).toBe("CLIENT");
  });

  it("каждой схеме — своё поле", () => {
    expect(numberFieldFor("OUR_SALE")).toBe("ourNumber");
    expect(numberFieldFor("OUR_RENTAL")).toBe("ourNumber");
    expect(numberFieldFor("CLIENT")).toBe("clientNumber");
  });

  it("номер показывается так, как написан на железе", () => {
    expect(formatMachineNumber({ category: "OUR_SALE", ourNumber: 5, clientNumber: null })).toBe("77-5");
    expect(formatMachineNumber({ category: "CLIENT", ourNumber: null, clientNumber: 5 })).toBe("К-5");
    expect(formatMachineNumber({ category: "OUR_RENTAL", ourNumber: 12, clientNumber: null })).toBe(
      "77-12",
    );
  });

  it("буква «К» — кириллическая (интерфейс русский, маркер тоже)", () => {
    const label = formatMachineNumber({ category: "CLIENT", ourNumber: null, clientNumber: 1 });
    expect(label).toBe("К-1");
    expect(label?.charCodeAt(0)).toBe("К".charCodeAt(0)); // не латинская K (0x4B)
    expect(label?.charCodeAt(0)).not.toBe(0x4b);
  });

  it("без номера — null, а не «77-null»", () => {
    expect(formatMachineNumber({ category: "OUR_SALE", ourNumber: null, clientNumber: null })).toBeNull();
    expect(formatMachineNumber({ category: "CLIENT", ourNumber: null, clientNumber: null })).toBeNull();
    expect(machineNumberValue({ category: "CLIENT", ourNumber: null, clientNumber: null })).toBeNull();
  });

  it("чужой номер в неподходящем поле не показывается: номер читается по категории", () => {
    // Карточка переехала в клиентские — «77-N» на ней уже не её номер.
    expect(formatMachineNumber({ category: "CLIENT", ourNumber: 7, clientNumber: null })).toBeNull();
    expect(formatMachineNumber({ category: "OUR_SALE", ourNumber: null, clientNumber: 7 })).toBeNull();
  });

  it("formatNumberIn — для формы, где категория ещё выбирается", () => {
    expect(formatNumberIn("OUR", 3)).toBe("77-3");
    expect(formatNumberIn("CLIENT", 3)).toBe("К-3");
    expect(formatNumberIn("CLIENT", null)).toBeNull();
    expect(formatNumberIn("OUR", undefined)).toBeNull();
  });
});

describe("machine-number: написания для поиска", () => {
  it("клиентский находится и кириллицей, и латиницей, с дефисом и без", () => {
    const variants = machineNumberSearchVariants({
      category: "CLIENT",
      ourNumber: null,
      clientNumber: 5,
    });
    expect(variants).toEqual(["к-5", "к5", "k-5", "k5"]);
  });

  it("своему железу вариантов не нужно — его ищет цифровой путь", () => {
    expect(
      machineNumberSearchVariants({ category: "OUR_SALE", ourNumber: 5, clientNumber: null }),
    ).toEqual([]);
  });

  it("без номера вариантов нет", () => {
    expect(
      machineNumberSearchVariants({ category: "CLIENT", ourNumber: null, clientNumber: null }),
    ).toEqual([]);
  });
});
