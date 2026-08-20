import { describe, it, expect } from "vitest";
import {
  formatMachineNumber,
  formatNumberIn,
  machineNumberSearchVariants,
  machineNumberValue,
  numberFieldFor,
  numberSchemeFor,
  schemeOfNumber,
} from "./machine-number";
import type { MachineCategory } from "@/generated/prisma/enums";

const BOTH: MachineCategory[] = ["OUR_SALE", "OUR_RENTAL"];

describe("machine-number: схема нумерации по категориям (выдача номера)", () => {
  it("своё железо нумеруется «77-N», чужое — «К-N»", () => {
    expect(numberSchemeFor(["OUR_SALE"])).toBe("OUR");
    expect(numberSchemeFor(["OUR_RENTAL"])).toBe("OUR");
    expect(numberSchemeFor(BOTH)).toBe("OUR");
    expect(numberSchemeFor(["CLIENT"])).toBe("CLIENT");
  });

  it("каждой схеме — своё поле", () => {
    expect(numberFieldFor(["OUR_SALE"])).toBe("ourNumber");
    expect(numberFieldFor(["OUR_RENTAL"])).toBe("ourNumber");
    expect(numberFieldFor(BOTH)).toBe("ourNumber");
    expect(numberFieldFor(["CLIENT"])).toBe("clientNumber");
  });

  it("вторая наша категория номер не переселяет — парк один и тот же", () => {
    // Продажа ↔ аренда (в том числе обе сразу) — это одно железо одного парка: «77-N» остаётся.
    expect(numberFieldFor(["OUR_SALE"])).toBe(numberFieldFor(BOTH));
  });
});

describe("machine-number: номер читается из заполненного поля", () => {
  it("заполнен ourNumber — схема «77-N», заполнен clientNumber — «К-N»", () => {
    expect(schemeOfNumber({ ourNumber: 5, clientNumber: null })).toBe("OUR");
    expect(schemeOfNumber({ ourNumber: null, clientNumber: 5 })).toBe("CLIENT");
    expect(schemeOfNumber({ ourNumber: null, clientNumber: null })).toBeNull();
  });

  it("второе номерное поле может вообще отсутствовать (короткий DTO комплекта)", () => {
    expect(schemeOfNumber({ ourNumber: 5 })).toBe("OUR");
    expect(schemeOfNumber({ ourNumber: null })).toBeNull();
    expect(formatMachineNumber({ ourNumber: 5 })).toBe("77-5");
  });

  it("номер показывается так, как написан на железе", () => {
    expect(formatMachineNumber({ ourNumber: 5, clientNumber: null })).toBe("77-5");
    expect(formatMachineNumber({ ourNumber: null, clientNumber: 5 })).toBe("К-5");
    expect(formatMachineNumber({ ourNumber: 12, clientNumber: null })).toBe("77-12");
  });

  it("категории на печать номера не влияют — их тут просто нет", () => {
    // Раньше формат читался из категории, и в момент переезда карточки (категории уже поменяли,
    // номер ещё переносится) номер пропадал с экрана. Теперь говорит само поле: у станка с
    // clientNumber = 5 всюду «К-5», включая места без категорий под рукой (комплект, задание в цех).
    expect(formatMachineNumber({ ourNumber: null, clientNumber: 5 })).toBe("К-5");
    expect(machineNumberValue({ ourNumber: null, clientNumber: 5 })).toBe(5);
    expect(schemeOfNumber({ ourNumber: null, clientNumber: 5 })).toBe("CLIENT");
  });

  it("буква «К» — кириллическая (интерфейс русский, маркер тоже)", () => {
    const label = formatMachineNumber({ ourNumber: null, clientNumber: 1 });
    expect(label).toBe("К-1");
    expect(label?.charCodeAt(0)).toBe("К".charCodeAt(0)); // не латинская K (0x4B)
    expect(label?.charCodeAt(0)).not.toBe(0x4b);
  });

  it("без номера — null, а не «77-null»", () => {
    expect(formatMachineNumber({ ourNumber: null, clientNumber: null })).toBeNull();
    expect(machineNumberValue({ ourNumber: null, clientNumber: null })).toBeNull();
  });

  it("formatNumberIn — для формы, где категории ещё выбираются", () => {
    expect(formatNumberIn("OUR", 3)).toBe("77-3");
    expect(formatNumberIn("CLIENT", 3)).toBe("К-3");
    expect(formatNumberIn("CLIENT", null)).toBeNull();
    expect(formatNumberIn("OUR", undefined)).toBeNull();
  });
});

describe("machine-number: написания для поиска", () => {
  it("клиентский находится и кириллицей, и латиницей, с дефисом и без", () => {
    expect(machineNumberSearchVariants({ ourNumber: null, clientNumber: 5 })).toEqual([
      "к-5",
      "к5",
      "k-5",
      "k5",
    ]);
  });

  it("своему железу вариантов не нужно — его ищет цифровой путь", () => {
    expect(machineNumberSearchVariants({ ourNumber: 5, clientNumber: null })).toEqual([]);
  });

  it("без номера вариантов нет", () => {
    expect(machineNumberSearchVariants({ ourNumber: null, clientNumber: null })).toEqual([]);
  });
});
