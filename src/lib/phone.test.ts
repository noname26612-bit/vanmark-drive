import { describe, it, expect } from "vitest";
import { parsePhones, telHref, formatPhoneRu } from "./phone";

/** Короткая выжимка результата — так тесты читаются как таблица «строка → номера». */
function hrefs(raw: string | null | undefined): string[] {
  return parsePhones(raw).map((p) => p.href);
}

describe("parsePhones — пустое и мусор", () => {
  it("пустая строка, null, undefined и пробелы → []", () => {
    expect(parsePhones(null)).toEqual([]);
    expect(parsePhones(undefined)).toEqual([]);
    expect(parsePhones("")).toEqual([]);
    expect(parsePhones("   ")).toEqual([]);
  });

  it("строка без номера → []", () => {
    expect(parsePhones("—")).toEqual([]);
    expect(parsePhones("нет телефона")).toEqual([]);
    expect(parsePhones("уточнить у Милены")).toEqual([]);
  });
});

describe("parsePhones — один номер", () => {
  it("формат с плюсом и разделителями", () => {
    const [p] = parsePhones("+7 926 123-45-67");
    expect(p.digits).toBe("79261234567");
    expect(p.href).toBe("tel:+79261234567");
    expect(p.display).toBe("+7 926 123-45-67");
    expect(p.intl).toBe(false);
  });

  it("восьмёрка приводится к +7", () => {
    expect(hrefs("8 (926) 123-45-67")).toEqual(["tel:+79261234567"]);
    expect(hrefs("89261234567")).toEqual(["tel:+79261234567"]);
    expect(hrefs("8-926-123-45-67")).toEqual(["tel:+79261234567"]);
  });

  it("десять цифр без кода страны дополняются семёркой", () => {
    expect(hrefs("495 123-45-67")).toEqual(["tel:+74951234567"]);
    expect(hrefs("9261234567")).toEqual(["tel:+79261234567"]);
  });

  it("длинный городской не разрезается надвое", () => {
    expect(hrefs("84951234567")).toEqual(["tel:+74951234567"]);
  });

  it("короткий городской набирается как есть, без +7", () => {
    const [p] = parsePhones("123-45-67");
    expect(p.href).toBe("tel:1234567");
    expect(p.display).toBe("123-45-67");
  });
});

describe("parsePhones — несколько номеров", () => {
  it("через запятую", () => {
    expect(hrefs("89261234567, 89167654321")).toEqual(["tel:+79261234567", "tel:+79167654321"]);
  });

  it("через точку с запятой, слэш, вертикальную черту и перенос строки", () => {
    const expected = ["tel:+79261234567", "tel:+79167654321"];
    expect(hrefs("+7 926 123-45-67; +7 916 765-43-21")).toEqual(expected);
    expect(hrefs("+7 926 123-45-67 / +7 916 765-43-21")).toEqual(expected);
    expect(hrefs("+7 926 123-45-67 | +7 916 765-43-21")).toEqual(expected);
    expect(hrefs("+79261234567\n+79167654321")).toEqual(expected);
  });

  it("три номера — все три отдельно", () => {
    expect(hrefs("+7 926 123-45-67, 8 916 765-43-21, 8 495 111-22-33")).toEqual([
      "tel:+79261234567",
      "tel:+79167654321",
      "tel:+74951112233",
    ]);
  });

  it("слепленные через плюс без разделителя", () => {
    expect(hrefs("+79261234567+79167654321")).toEqual(["tel:+79261234567", "tel:+79167654321"]);
  });

  it("слепленные через пробел без разделителя", () => {
    expect(hrefs("89261234567 89167654321")).toEqual(["tel:+79261234567", "tel:+79167654321"]);
  });

  it("одинаковые номера схлопываются", () => {
    expect(hrefs("+7 926 123-45-67, 8 926 123 45 67")).toEqual(["tel:+79261234567"]);
  });

  it("больше пяти номеров обрезается до пяти", () => {
    const many = [
      "89261111111",
      "89262222222",
      "89263333333",
      "89264444444",
      "89265555555",
      "89266666666",
      "89267777777",
      "89268888888",
    ].join(", ");
    expect(parsePhones(many)).toHaveLength(5);
  });
});

describe("parsePhones — подписи и добавочные", () => {
  it("подпись из скобок", () => {
    const list = parsePhones("+7 926 123-45-67 (Иван), +7 916 765-43-21 (склад)");
    expect(list.map((p) => p.label)).toEqual(["Иван", "склад"]);
    expect(list.map((p) => p.href)).toEqual(["tel:+79261234567", "tel:+79167654321"]);
  });

  it("код региона в скобках подписью не считается", () => {
    const [p] = parsePhones("8 (926) 123-45-67");
    expect(p.label).toBeNull();
  });

  it("подпись перед номером", () => {
    const [p] = parsePhones("Иван +7 926 123 45 67");
    expect(p.label).toBe("Иван");
    expect(p.href).toBe("tel:+79261234567");
  });

  it("служебные слова подписью не считаются", () => {
    expect(parsePhones("тел. +7 926 123-45-67")[0].label).toBeNull();
    expect(parsePhones("моб +7 926 123-45-67")[0].label).toBeNull();
  });

  it("добавочный уходит в паузу набора", () => {
    const [p] = parsePhones("+7 495 123-45-67 доб. 1234");
    expect(p.ext).toBe("1234");
    expect(p.href).toBe("tel:+74951234567,1234");
  });

  it("добавочный отдельным фрагментом приклеивается к предыдущему номеру", () => {
    const [p] = parsePhones("+7 495 123-45-67 / доб. 5");
    expect(p.ext).toBe("5");
    expect(p.href).toBe("tel:+74951234567,5");
  });
});

describe("parsePhones — иностранные номера", () => {
  it("не приводятся к российскому виду", () => {
    const [p] = parsePhones("+380 67 123 45 67");
    expect(p.intl).toBe(true);
    expect(p.href).toBe("tel:+380671234567");
  });
});

describe("parsePhones — безопасность href", () => {
  it("посторонний текст рядом не попадает в набор", () => {
    const [p] = parsePhones("+7 926 123-45-67 javascript:alert(1)");
    expect(p.href).toBe("tel:+79261234567");
  });

  it("href состоит только из цифр, ведущего плюса и запятой", () => {
    for (const raw of [
      "+7 926 123-45-67",
      "8 (926) 123-45-67 доб. 12",
      "123-45-67",
      "+380 67 123 45 67",
      "<script>8 926 123 45 67</script>",
    ]) {
      for (const p of parsePhones(raw)) {
        expect(p.href).toMatch(/^tel:\+?\d+(,\d+)?$/);
      }
    }
  });
});

describe("telHref и formatPhoneRu", () => {
  it("telHref чистит вход", () => {
    expect(telHref("7 926 123 45 67")).toBe("tel:+79261234567");
    expect(telHref("1234567")).toBe("tel:1234567");
    expect(telHref("")).toBe("");
  });

  it("formatPhoneRu форматирует российские и короткие номера", () => {
    expect(formatPhoneRu("79261234567")).toBe("+7 926 123-45-67");
    expect(formatPhoneRu("1234567")).toBe("123-45-67");
    expect(formatPhoneRu("123456")).toBe("12-34-56");
    expect(formatPhoneRu("380671234567", true)).toBe("+380671234567");
  });
});
