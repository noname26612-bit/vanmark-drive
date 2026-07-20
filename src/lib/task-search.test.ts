import { describe, it, expect } from "vitest";
import {
  parseQuery,
  taskMatches,
  highlightRanges,
  phoneHighlightRanges,
  firstHiddenMatch,
  normalizeText,
  type SearchableTask,
} from "./task-search";

// Типовая задача VanMark: выездной ремонт с контактами заказчика.
const task: SearchableTask = {
  number: 615,
  title: "ЛБМ 200 + нож, ремонт приёмного стола",
  address: "г. Королёв, ул. Алмазная, 12с3",
  description: "Заказчик просил позвонить за час",
  equipment: "Sorex 2 м",
  orgName: "ДОМОСТРОЙ ЛОГИСТИК ООО",
  contactName: "Пётр Семёнов",
  contactPhone: "+7 (926) 123-45-67",
  invoiceNumber: "948",
  type: { name: "Выездной ремонт" },
  assignee: { name: "Алексей Каширский" },
};

describe("parseQuery", () => {
  it("пустой и пробельный запрос неактивен", () => {
    expect(parseQuery("").active).toBe(false);
    expect(parseQuery("   ").active).toBe(false);
  });

  it("режет на токены, нормализует регистр и ё", () => {
    const q = parseQuery("  Королёв  НОЖ ");
    expect(q.active).toBe(true);
    expect(q.tokens).toHaveLength(2);
    expect(q.tokens[0].variants).toContain("королев");
    expect(q.tokens[1].variants).toContain("нож");
  });
});

describe("taskMatches — текстовые поля", () => {
  it("находит по названию, регистр не важен", () => {
    expect(taskMatches(task, parseQuery("лбм"))).toBe(true);
    expect(taskMatches(task, parseQuery("ПРИЁМНОГО"))).toBe(true);
  });

  it("ё и е взаимозаменяемы в обе стороны", () => {
    expect(taskMatches(task, parseQuery("королев"))).toBe(true); // в базе «Королёв»
    expect(taskMatches(task, parseQuery("Семёнов"))).toBe(true);
    expect(taskMatches(task, parseQuery("семенов"))).toBe(true);
  });

  it("ищет по адресу, организации, контакту, типу, водителю и оборудованию", () => {
    expect(taskMatches(task, parseQuery("алмазная"))).toBe(true);
    expect(taskMatches(task, parseQuery("домострой"))).toBe(true);
    expect(taskMatches(task, parseQuery("пётр"))).toBe(true);
    expect(taskMatches(task, parseQuery("выездной"))).toBe(true);
    expect(taskMatches(task, parseQuery("каширский"))).toBe(true);
    expect(taskMatches(task, parseQuery("sorex"))).toBe(true);
  });

  it("мультитокенный запрос — AND: все слова обязаны найтись (в разных полях можно)", () => {
    expect(taskMatches(task, parseQuery("каширский ремонт"))).toBe(true);
    expect(taskMatches(task, parseQuery("каширский доставка"))).toBe(false);
  });

  it("не находит чужое", () => {
    expect(taskMatches(task, parseQuery("писарев"))).toBe(false);
    expect(taskMatches(task, parseQuery("гибка"))).toBe(false);
  });
});

describe("taskMatches — номера и телефон", () => {
  it("находит по № заявки: «615» и «№615»", () => {
    expect(taskMatches(task, parseQuery("615"))).toBe(true);
    expect(taskMatches(task, parseQuery("№615"))).toBe(true);
  });

  it("находит по № счёта", () => {
    expect(taskMatches(task, parseQuery("948"))).toBe(true);
  });

  it("двухзначный обрывок номера ищется, однозначный — нет (шум)", () => {
    expect(taskMatches(task, parseQuery("61"))).toBe(true); // «61» входит в «615»
    expect(taskMatches(task, parseQuery("7"))).toBe(false);
  });

  it("цифры в тексте («ЛБМ 200») находятся числовым запросом", () => {
    expect(taskMatches(task, parseQuery("200"))).toBe(true); // «ЛБМ 200» в названии
    expect(taskMatches(task, parseQuery("12с3"))).toBe(true); // дом в адресе — не numeric, токен
    const stamp: SearchableTask = { ...task, title: "E2E поиск 1784555657463" };
    expect(taskMatches(stamp, parseQuery("1784555657463"))).toBe(true); // длинное число в тексте
  });

  it("телефон находится в любом формате записи запроса", () => {
    expect(taskMatches(task, parseQuery("9261234567"))).toBe(true);
    expect(taskMatches(task, parseQuery("+7 926 123-45-67"))).toBe(true); // копипаста целиком
    expect(taskMatches(task, parseQuery("+7 (926) 123 45 67"))).toBe(true);
    expect(taskMatches(task, parseQuery("926"))).toBe(true);
    expect(taskMatches(task, parseQuery("123-45-67"))).toBe(true);
  });

  it("«№ 615» с пробелом и одинокая пунктуация не ломают поиск", () => {
    expect(taskMatches(task, parseQuery("№ 615"))).toBe(true);
    expect(parseQuery("+").active).toBe(false);
    // смешанный запрос: пунктуационный токен «-» игнорируется, слова работают
    expect(taskMatches(task, parseQuery("нож - ремонт"))).toBe(true);
  });

  it("8 в начале приравнивается к +7", () => {
    expect(taskMatches(task, parseQuery("89261234567"))).toBe(true);
    const t8: SearchableTask = { ...task, contactPhone: "8 926 555 44 33" };
    expect(taskMatches(t8, parseQuery("+79265554433"))).toBe(true);
  });

  it("две цифры не матчят телефон (порог 3)", () => {
    expect(taskMatches({ ...task, number: 500, invoiceNumber: null }, parseQuery("92"))).toBe(false);
  });
});

describe("taskMatches — ошибочная раскладка", () => {
  it("латиница вместо кириллицы: «fkvfp» → «алмаз»", () => {
    expect(taskMatches(task, parseQuery("fkvfp"))).toBe(true); // алмаз
    expect(taskMatches(task, parseQuery("rfibhcrbq"))).toBe(true); // каширский
  });

  it("кириллица вместо латиницы: «ыщкуч» → «sorex»", () => {
    expect(taskMatches(task, parseQuery("ыщкуч"))).toBe(true);
  });

  it("одиночная буква раскладкой не конвертируется", () => {
    expect(taskMatches(task, parseQuery("f"))).toBe(false); // не превращается в «а»
  });
});

describe("highlightRanges", () => {
  it("возвращает диапазоны в исходной строке (ё-нормализация не сдвигает индексы)", () => {
    const r = highlightRanges("г. Королёв, ул. Алмазная", parseQuery("королев"));
    expect(r).toEqual([{ start: 3, end: 10 }]);
    expect("г. Королёв, ул. Алмазная".slice(3, 10)).toBe("Королёв");
  });

  it("несколько вхождений и слияние пересечений", () => {
    const r = highlightRanges("нож нож", parseQuery("нож"));
    expect(r).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    const merged = highlightRanges("абвгд", parseQuery("абв бвг"));
    expect(merged).toEqual([{ start: 0, end: 4 }]);
  });

  it("цифровой токен «№615» подсвечивает «615» в тексте", () => {
    const r = highlightRanges("Заявка 615 повтор", parseQuery("№615"));
    expect(r).toEqual([{ start: 7, end: 10 }]);
  });

  it("пустой запрос — без диапазонов", () => {
    expect(highlightRanges("текст", parseQuery(""))).toEqual([]);
  });
});

describe("phoneHighlightRanges", () => {
  it("подсвечивает цифры сквозь форматирование", () => {
    const phone = "+7 (926) 123-45-67";
    const r = phoneHighlightRanges(phone, parseQuery("12345"));
    expect(r).toHaveLength(1);
    // «123-45» в исходной записи: от «1» до «5» включительно, с дефисом внутри
    expect(phone.slice(r[0].start, r[0].end)).toBe("123-45");
  });

  it("вариант 8↔7 подсвечивается с начала номера", () => {
    const phone = "+7 (926) 123-45-67";
    const r = phoneHighlightRanges(phone, parseQuery("8926123"));
    expect(r).toHaveLength(1);
    expect(r[0].start).toBe(1); // с «7» в «+7»
  });
});

describe("firstHiddenMatch — сниппет «почему нашлось»", () => {
  it("совпадение в видимых полях — сниппет не нужен", () => {
    expect(firstHiddenMatch(task, parseQuery("ремонт"), [task.title, task.address ?? ""])).toBeNull();
    expect(firstHiddenMatch(task, parseQuery("615"), [task.title, task.address ?? ""])).toBeNull();
  });

  it("телефон — первый в приоритете скрытых полей", () => {
    const m = firstHiddenMatch(task, parseQuery("926"), [task.title, task.address ?? ""]);
    expect(m).not.toBeNull();
    expect(m?.label).toBe("Тел.");
    expect(m?.phone).toBe(true);
  });

  it("организация и счёт дают сниппет со своей подписью", () => {
    const org = firstHiddenMatch(task, parseQuery("домострой"), [task.title, task.address ?? ""]);
    expect(org?.label).toBe("Орг.");
    const inv = firstHiddenMatch(task, parseQuery("948"), [task.title, task.address ?? ""]);
    expect(inv?.label).toBe("Счёт");
  });

  it("неактивный запрос — null", () => {
    expect(firstHiddenMatch(task, parseQuery(""), [task.title])).toBeNull();
  });
});

describe("normalizeText", () => {
  it("сохраняет длину строки (посимвольная нормализация)", () => {
    const samples = ["Ёжик Ё ё", "ABC абв", "№615 +7 (926)"];
    for (const s of samples) expect(normalizeText(s)).toHaveLength(s.length);
  });
});
