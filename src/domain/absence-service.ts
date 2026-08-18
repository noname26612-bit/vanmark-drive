// Доменный сервис отсутствий сотрудника (этап E, №9): отпуск/больничный/прочее на диапазон дат.
// Заводят админ и диспетчер (гейт requireDispatcher в route). ВАЖНО (исключение из CLAUDE.md §1):
// отпуск ставят ЗА ДРУГОГО — driverId приходит в теле и валидируется в сервисе, а не берётся
// из сессии. Личность создавшего (createdById) — из сессии.
//
// С 18.08.2026 (вкладка «Команда», PRD §18) отпуск можно завести ЛЮБОМУ действующему сотруднику
// компании, а не только водителю: Артёму нужно видеть отпуска всего коллектива в одном месте.
// Проверка стала «действующий и не внешний» вместо «роль = DRIVER». Имена модели и поля остались
// историческими (driverId) — таблица живая, переименование дало бы миграцию ради косметики.
// Календарь загрузки и KPI читают эти же записи, но только по водителям, поэтому отпуск Милены
// или цехового сотрудника на их расчёты не влияет.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import type { AbsenceType } from "@/generated/prisma/enums";

export type Actor = { id: string; role: string };

export type AbsenceView = {
  id: string;
  driverId: string;
  driverName: string | null;
  dateFrom: string; // YYYY-MM-DD (включительно)
  dateTo: string; // YYYY-MM-DD (включительно)
  type: AbsenceType;
  note: string | null;
};

const ABSENCE_TYPES: AbsenceType[] = ["VACATION", "SICK", "OTHER"];

// YYYY-MM-DD → Date в UTC-полночь (@db.Date хранит только дату). Как в shift/task.
function parseDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Errors.validation("Некорректная дата");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw Errors.validation("Некорректная дата");
  return d;
}

type AbsenceRow = {
  id: string;
  driverId: string;
  dateFrom: Date;
  dateTo: Date;
  type: AbsenceType;
  note: string | null;
  driver?: { name: string } | null;
};

function toView(a: AbsenceRow): AbsenceView {
  return {
    id: a.id,
    driverId: a.driverId,
    driverName: a.driver?.name ?? null,
    dateFrom: a.dateFrom.toISOString().slice(0, 10),
    dateTo: a.dateTo.toISOString().slice(0, 10),
    type: a.type,
    note: a.note,
  };
}

/** Отсутствия, пересекающие период [fromKey, toKey] (включительно). Для календаря загрузки. */
export async function listAbsencesInRange(fromKey: string, toKey: string): Promise<AbsenceView[]> {
  const from = parseDate(fromKey);
  const to = parseDate(toKey);
  if (from > to) throw Errors.validation("Некорректный период");
  // Пересечение диапазонов: начался не позже конца окна И закончился не раньше начала окна.
  const rows = await prisma.driverAbsence.findMany({
    where: { dateFrom: { lte: to }, dateTo: { gte: from } },
    include: { driver: { select: { name: true } } },
    orderBy: [{ dateFrom: "asc" }],
  });
  return rows.map(toView);
}

/**
 * Отсутствия ДЕЙСТВУЮЩИХ сотрудников, которые ещё не закончились на день `fromKey` (текущие и
 * запланированные). Для вкладки «Команда»: верхней границы нет — отпуска планируют на месяцы вперёд.
 *
 * Фильтр по сотруднику обязателен: записи ушедшего мы не удаляем (история), но показывать «отпуск»
 * человека, которого уже нет в справочнике, — значит показывать призрака.
 */
export async function listAbsencesFrom(fromKey: string): Promise<AbsenceView[]> {
  const from = parseDate(fromKey);
  const rows = await prisma.driverAbsence.findMany({
    where: { dateTo: { gte: from }, driver: { isActive: true, isExternal: false } },
    include: { driver: { select: { name: true } } },
    orderBy: [{ dateFrom: "asc" }],
  });
  return rows.map(toView);
}

/**
 * Завести отсутствие. driverId — за другого: валидируем как ДЕЙСТВУЮЩЕГО ВНУТРЕННЕГО сотрудника
 * любой роли (18.08.2026); создавший — из сессии. Внешний перевозчик исключён: он не в штате,
 * отпусков у него не бывает.
 */
export async function createAbsence(
  input: { driverId: string; dateFrom: string; dateTo: string; type?: string; note?: string | null },
  actor: Actor,
): Promise<AbsenceView> {
  const from = parseDate(input.dateFrom);
  const to = parseDate(input.dateTo);
  if (from > to) throw Errors.validation("Дата начала позже даты окончания");
  const type: AbsenceType = ABSENCE_TYPES.includes(input.type as AbsenceType)
    ? (input.type as AbsenceType)
    : "VACATION";
  const person = await prisma.user.findUnique({
    where: { id: input.driverId },
    select: { id: true, isActive: true, isExternal: true },
  });
  if (!person || !person.isActive || person.isExternal) {
    throw Errors.validation("Отпуск можно завести только действующему сотруднику компании");
  }
  const created = await prisma.driverAbsence.create({
    data: {
      driverId: input.driverId,
      dateFrom: from,
      dateTo: to,
      type,
      note: input.note?.trim() || null,
      createdById: actor.id,
    },
    include: { driver: { select: { name: true } } },
  });
  return toView(created);
}

/** Удалить отсутствие по id (диспетчер/админ). */
export async function deleteAbsence(id: string): Promise<void> {
  const existing = await prisma.driverAbsence.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw Errors.notFound();
  await prisma.driverAbsence.delete({ where: { id } });
}

/**
 * Карта «водитель → множество дней (YYYY-MM-DD) в отсутствии» за период. Для KPI (не штрафовать
 * «невыполненную точку» в дни отпуска, №9) и для календаря. Дни — по UTC-датам (как @db.Date).
 */
export async function absenceDaysByDriver(fromKey: string, toKey: string): Promise<Map<string, Set<string>>> {
  const absences = await listAbsencesInRange(fromKey, toKey);
  const map = new Map<string, Set<string>>();
  for (const a of absences) {
    let set = map.get(a.driverId);
    if (!set) {
      set = new Set<string>();
      map.set(a.driverId, set);
    }
    const cur = new Date(`${a.dateFrom}T00:00:00.000Z`);
    const end = new Date(`${a.dateTo}T00:00:00.000Z`);
    for (; cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
      set.add(cur.toISOString().slice(0, 10));
    }
  }
  return map;
}
