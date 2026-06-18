import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

const BOM = String.fromCharCode(0xfeff);

describe("csv — toCsv", () => {
  it("разделитель «;», CRLF между строками, BOM в начале", () => {
    const out = toCsv([
      ["Водитель", "Выполнено"],
      ["Алексей Каширский", 18],
    ]);
    expect(out).toBe(`${BOM}Водитель;Выполнено\r\nАлексей Каширский;18`);
  });

  it("экранирует ячейки с разделителем, кавычками и переводом строки", () => {
    const out = toCsv([["a;b", 'он сказал "да"', "две\nстроки"]], { bom: false });
    expect(out).toBe('"a;b";"он сказал ""да""";"две\nстроки"');
  });

  it("null/undefined → пустая ячейка", () => {
    expect(toCsv([["x", null, undefined, 0]], { bom: false })).toBe("x;;;0");
  });

  it("bom:false убирает префикс", () => {
    expect(toCsv([["a"]], { bom: false })).toBe("a");
  });
});
