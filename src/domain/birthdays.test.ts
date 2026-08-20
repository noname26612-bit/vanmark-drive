import { describe, it, expect } from "vitest";
import {
  birthdaysOn,
  celebrationInYear,
  daysBetween,
  formatBirthdayLabel,
  matchesBirthday,
  nextBirthdayDate,
  upcomingBirthdays,
} from "./birthdays";

describe("matchesBirthday", () => {
  it("совпадает по дню и месяцу, год рождения не важен", () => {
    expect(matchesBirthday("1990-08-21", "2026-08-21")).toBe(true);
    expect(matchesBirthday("1990-08-21", "2026-08-22")).toBe(false);
    expect(matchesBirthday("1990-08-21", "2026-09-21")).toBe(false);
  });

  it("29 февраля в невисокосный год отмечаем 28-го", () => {
    // 2026 — невисокосный: 29 февраля не существует, поздравляем 28-го.
    expect(matchesBirthday("1992-02-29", "2026-02-28")).toBe(true);
    expect(matchesBirthday("1992-02-29", "2026-03-01")).toBe(false);
  });

  it("29 февраля в високосный год отмечаем строго 29-го", () => {
    // 2028 — високосный: 28-го ещё не праздник, 29-го — да.
    expect(matchesBirthday("1992-02-29", "2028-02-28")).toBe(false);
    expect(matchesBirthday("1992-02-29", "2028-02-29")).toBe(true);
  });

  it("рождённого 28 февраля не сдвигает и не задваивает", () => {
    expect(matchesBirthday("1990-02-28", "2026-02-28")).toBe(true);
    expect(matchesBirthday("1990-02-28", "2028-02-28")).toBe(true);
    expect(matchesBirthday("1990-02-28", "2028-02-29")).toBe(false);
  });

  it("век без високоса (1900, 2100) считается невисокосным", () => {
    expect(celebrationInYear("1992-02-29", 2100)).toBe("2100-02-28");
    expect(celebrationInYear("1992-02-29", 2000)).toBe("2000-02-29");
  });
});

describe("nextBirthdayDate", () => {
  it("сегодняшний день рождения — это и есть ближайший", () => {
    expect(nextBirthdayDate("1990-08-21", "2026-08-21")).toBe("2026-08-21");
  });

  it("прошедший в этом году переносится на следующий", () => {
    expect(nextBirthdayDate("1990-08-21", "2026-08-22")).toBe("2027-08-21");
  });

  it("переход через Новый год: 1 января ближайший ДР 29 декабря — уже в этом году не был", () => {
    expect(nextBirthdayDate("1990-12-29", "2027-01-01")).toBe("2027-12-29");
    // А 29 декабря для 27 декабря — это ещё текущий год.
    expect(nextBirthdayDate("1990-12-29", "2026-12-27")).toBe("2026-12-29");
  });

  it("29 февраля после 28.02 невисокосного года уезжает на следующий год", () => {
    expect(nextBirthdayDate("1992-02-29", "2026-03-01")).toBe("2027-02-28");
  });
});

describe("upcomingBirthdays", () => {
  const people = [
    { id: "u1", name: "Милена", birthday: "1990-08-21" },
    { id: "u2", name: "Алексей Писарев", birthday: "1985-08-21" },
    { id: "u3", name: "Максим", birthday: "1988-12-31" },
    { id: "u4", name: "Без даты", birthday: null },
  ];

  it("берёт только тех, кто попадает в горизонт", () => {
    const list = upcomingBirthdays(people, "2026-08-18", 7);
    expect(list.map((b) => b.id)).toEqual(["u2", "u1"]); // одна дата → по алфавиту
    expect(list[0]).toMatchObject({ date: "2026-08-21", inDays: 3, label: "21 августа" });
  });

  it("человека без даты рождения пропускает молча", () => {
    const list = upcomingBirthdays(people, "2026-08-18", 400);
    expect(list.some((b) => b.id === "u4")).toBe(false);
  });

  it("горизонт включает границу и перешагивает Новый год", () => {
    const list = upcomingBirthdays(people, "2026-12-28", 3);
    expect(list.map((b) => b.id)).toEqual(["u3"]);
    expect(list[0].inDays).toBe(3);

    const nextYear = upcomingBirthdays(people, "2027-01-01", 5);
    expect(nextYear).toEqual([]); // ближайший ДР Максима теперь только через год
  });

  it("сегодняшний день рождения показывается с inDays = 0", () => {
    const list = upcomingBirthdays(people, "2026-08-21", 1);
    expect(list.every((b) => b.inDays === 0)).toBe(true);
  });
});

describe("birthdaysOn", () => {
  const people = [
    { id: "u1", name: "Милена", birthday: "1990-08-21" },
    { id: "u2", name: "Високосный", birthday: "1992-02-29" },
    { id: "u3", name: "Без даты", birthday: null },
  ];

  it("находит именинников конкретного дня", () => {
    expect(birthdaysOn(people, "2026-08-21").map((p) => p.id)).toEqual(["u1"]);
    expect(birthdaysOn(people, "2026-02-28").map((p) => p.id)).toEqual(["u2"]);
    expect(birthdaysOn(people, "2026-08-22")).toEqual([]);
  });

  it("работает для дня «через 3 дня» — рассылка ищет им же", () => {
    // 25.02 + 3 = 28.02 → в невисокосном 2026-м это и есть день рождения 29 февраля.
    expect(birthdaysOn(people, "2026-02-28").map((p) => p.name)).toEqual(["Високосный"]);
  });
});

describe("formatBirthdayLabel и daysBetween", () => {
  it("подпись — без года и в родительном падеже", () => {
    expect(formatBirthdayLabel("1990-08-21")).toBe("21 августа");
    expect(formatBirthdayLabel("1990-01-01")).toBe("1 января");
    expect(formatBirthdayLabel("1990-05-09")).toBe("9 мая");
    expect(formatBirthdayLabel("не дата")).toBe("");
  });

  it("считает дни между календарными днями", () => {
    expect(daysBetween("2026-08-18", "2026-08-21")).toBe(3);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-08-18", "2026-08-18")).toBe(0);
  });
});
