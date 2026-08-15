import { describe, it, expect } from "vitest";
import {
  parseStaffNumberQuery,
  staffNumberSearchVariants,
  taskNumber,
  taskNumberLabel,
} from "./task-number";

const delivery = { kind: "DELIVERY" as const, number: 615, staffNumber: null };
const staff = { kind: "STAFF" as const, number: 812, staffNumber: 5 };

describe("номер задачи в двух контурах (16.08.2026)", () => {
  it("заявка водителю показывается сквозным номером", () => {
    expect(taskNumber(delivery)).toBe("615");
    expect(taskNumberLabel(delivery)).toBe("№615");
  });

  it("задача цеха — своим номером с приставкой «Ц-»", () => {
    expect(taskNumber(staff)).toBe("Ц-5");
    expect(taskNumberLabel(staff)).toBe("Ц-5"); // «№» не дублируем: приставка уже говорит о номере
  });

  it("контур не задан (старый клиент, офлайн-кэш) — считаем доставкой", () => {
    expect(taskNumberLabel({ number: 700 })).toBe("№700");
  });

  it("задача цеха без своего номера показывает сквозной, а не пустоту", () => {
    expect(taskNumberLabel({ kind: "STAFF", number: 803, staffNumber: null })).toBe("№803");
  });
});

describe("поиск по номеру цеха", () => {
  it("варианты написания покрывают обе раскладки", () => {
    expect(staffNumberSearchVariants(staff)).toEqual(["ц-5", "ц5", "c-5", "c5"]);
  });

  it("у доставки вариантов нет — её ищут сквозным номером", () => {
    expect(staffNumberSearchVariants(delivery)).toEqual([]);
  });

  it("запрос разбирается и с приставкой, и без неё", () => {
    expect(parseStaffNumberQuery("Ц-5")).toBe(5);
    expect(parseStaffNumberQuery("ц5")).toBe(5);
    expect(parseStaffNumberQuery("c-12")).toBe(12);
    expect(parseStaffNumberQuery(" 7 ")).toBe(7);
  });

  it("телефон и текст номером цеха не считаются", () => {
    expect(parseStaffNumberQuery("89261234567")).toBeNull(); // длиннее 9 цифр — переполнило бы Int
    expect(parseStaffNumberQuery("ролики")).toBeNull();
    expect(parseStaffNumberQuery("ц")).toBeNull();
  });
});
