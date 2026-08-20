// Дни рождения коллег (вкладка «Команда», PRD §18, решение Артёма 18.08.2026) — чистое ядро.
// Здесь НЕТ prisma и server-only: модуль считает даты и покрыт юнит-тестами (vitest, node),
// а выборка людей и рассылка живут в src/domain/team-service.ts и src/domain/push-service.ts.
//
// Две вещи, из-за которых это отдельный модуль, а не пара строк в сервисе:
//  1. 29 февраля. В невисокосный год такого дня нет, а поздравить человека надо — отмечаем 28.02
//     (распространённая житейская договорённость; альтернатива «1 марта» отодвинула бы поздравление
//     на следующий месяц). В високосный год — строго 29.02.
//  2. Переход через Новый год. «Ближайший день рождения» 29 декабря для 1 января — это уже
//     СЛЕДУЮЩИЙ год, поэтому дату празднования всегда считаем в двух годах и берём первую подходящую.
//
// Год рождения в подписи не участвует: возраст коллеги — не наше дело (решение Артёма).
import { addDaysISO } from "@/lib/task-ui";

/** Человек для расчёта: birthday — «YYYY-MM-DD» или null (не заполнен). */
export type BirthdayPerson = {
  id: string;
  name: string;
  birthday: string | null;
};

export type UpcomingBirthday = {
  id: string;
  name: string;
  /** Дата ближайшего празднования, «YYYY-MM-DD» (уже с поправкой на 29.02). */
  date: string;
  /** Сколько дней осталось: 0 — сегодня, 3 — через три дня. */
  inDays: number;
  /** Подпись без года: «21 августа». */
  label: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Родительный падеж — подпись читается как «21 августа», а не «21 август».
const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Разбор «YYYY-MM-DD» без часовых поясов. null — если формат не тот (данные из БД, но бережёмся). */
function parts(iso: string): { year: number; month: number; day: number } | null {
  if (!DATE_RE.test(iso)) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Дата празднования дня рождения в конкретном году: обычно «тот же день», а для 29.02 в невисокосный
 * год — 28.02. Возвращает «YYYY-MM-DD» или null, если дата рождения нечитаемая.
 */
export function celebrationInYear(birthdayISO: string, year: number): string | null {
  const b = parts(birthdayISO);
  if (!b) return null;
  if (b.month === 2 && b.day === 29 && !isLeapYear(year)) return `${year}-02-28`;
  return `${year}-${pad(b.month)}-${pad(b.day)}`;
}

/** Празднуем ли день рождения `birthdayISO` в день `dateISO` (с поправкой на 29.02). */
export function matchesBirthday(birthdayISO: string, dateISO: string): boolean {
  const d = parts(dateISO);
  if (!d) return false;
  return celebrationInYear(birthdayISO, d.year) === dateISO;
}

/**
 * Ближайшее празднование, начиная с `fromISO` включительно. Считаем в текущем и следующем году —
 * это и закрывает переход через Новый год. null — если дата рождения нечитаемая.
 */
export function nextBirthdayDate(birthdayISO: string, fromISO: string): string | null {
  const from = parts(fromISO);
  if (!from) return null;
  for (const year of [from.year, from.year + 1]) {
    const date = celebrationInYear(birthdayISO, year);
    // Строки «YYYY-MM-DD» сравниваются лексикографически как даты — так же считает вся кодовая база.
    if (date && date >= fromISO) return date;
  }
  return null;
}

/** Число дней между двумя календарными днями «YYYY-MM-DD» (обе — UTC-полночь). */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00.000Z`);
  const to = Date.parse(`${toISO}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** Подпись дня рождения БЕЗ года: «21 августа». Пустая строка — если дата нечитаемая. */
export function formatBirthdayLabel(birthdayISO: string): string {
  const b = parts(birthdayISO);
  if (!b) return "";
  return `${b.day} ${MONTHS_GENITIVE[b.month - 1]}`;
}

/**
 * Ближайшие дни рождения в окне [today, today + horizonDays] включительно.
 * Люди без даты рождения просто не попадают в список. Сортировка — по дате, при совпадении по имени.
 */
export function upcomingBirthdays(
  people: BirthdayPerson[],
  todayISO: string,
  horizonDays: number,
): UpcomingBirthday[] {
  const until = addDaysISO(todayISO, horizonDays);
  const result: UpcomingBirthday[] = [];
  for (const person of people) {
    if (!person.birthday) continue;
    const date = nextBirthdayDate(person.birthday, todayISO);
    if (!date || date > until) continue;
    result.push({
      id: person.id,
      name: person.name,
      date,
      inDays: daysBetween(todayISO, date),
      label: formatBirthdayLabel(person.birthday),
    });
  }
  return result.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "ru") : a.date < b.date ? -1 : 1));
}

/** Человек с заполненной датой рождения — результат отбора именинников. */
export type CelebratingPerson = { id: string; name: string; birthday: string };

/** Кто празднует ровно в день `dateISO` (для рассылки: «сегодня» и «через 3 дня»). */
export function birthdaysOn(people: BirthdayPerson[], dateISO: string): CelebratingPerson[] {
  const result: CelebratingPerson[] = [];
  for (const person of people) {
    if (person.birthday && matchesBirthday(person.birthday, dateISO)) {
      result.push({ id: person.id, name: person.name, birthday: person.birthday });
    }
  }
  return result;
}
