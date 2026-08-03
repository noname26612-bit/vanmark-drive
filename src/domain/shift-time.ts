// Время открытия/закрытия смены: сборка момента из «дата + ЧЧ:ММ» по МСК и проверки закрытия
// (03.08.2026). Чистый модуль без Prisma — покрывается юнит-тестами без моков.
//
// Зачем дата, а не только время: смена водителя может идти через полночь («выехал в 22:00,
// вернулся в 02:15»), и раньше время закрытия жёстко привязывалось ко дню смены — такую смену
// нельзя было закрыть корректно. Теперь дата закрытия задаётся явно.
import { Errors } from "./errors";
import { parseHHMM } from "./kpi";

// Потолок длительности смены (решение Артёма 03.08). Смысл — не «трудовой лимит», а защита от
// опечатки в дате: закрыть июльскую смену августом означает молча испортить месячный отчёт
// (длина смены идёт в «отработано/простой» и в деньги Сводки). 24 часа перекрывают любую
// реальную смену с запасом, но опечатку в дате режут на порядок.
export const MAX_SHIFT_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** Локальная дата МСК «YYYY-MM-DD» + «ЧЧ:ММ» → UTC-момент. Формат валидируется. */
export function moscowMoment(dateISO: string, timeHHMM: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw Errors.validation("Некорректная дата — нужен формат ГГГГ-ММ-ДД");
  }
  const minutes = parseHHMM(timeHHMM);
  if (minutes === null) throw Errors.validation("Некорректное время — нужен формат ЧЧ:ММ");
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  // МСК = UTC+3 (как весь модуль KPI): иначе время смены «уедет» на 3 часа.
  const at = new Date(`${dateISO}T${hh}:${mm}:00.000+03:00`);
  if (Number.isNaN(at.getTime())) throw Errors.validation("Некорректная дата или время");
  return at;
}

/** Дата смены (@db.Date, UTC-полночь) → «YYYY-MM-DD». */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Проверки времени закрытия смены: строго позже открытия и не длиннее MAX_SHIFT_HOURS.
 * Тексты — для Милены, без техники.
 *
 * Отдельной проверки «не в будущем» нет намеренно: смена открывается в прошлом, значит потолок
 * длительности уже не даёт уехать дальше чем на сутки вперёд, а закрыть смену заранее указанным
 * временем («водитель сказал, что закончит в 18:00») — законный сценарий, работавший и раньше.
 */
export function assertClosedAtValid(openedAt: Date, closedAt: Date): void {
  if (closedAt.getTime() <= openedAt.getTime()) {
    throw Errors.validation("Время закрытия должно быть позже открытия смены");
  }
  if (closedAt.getTime() - openedAt.getTime() > MAX_SHIFT_HOURS * HOUR_MS) {
    throw Errors.validation(
      `Смена получается длиннее ${MAX_SHIFT_HOURS} часов — проверьте дату и время закрытия`,
    );
  }
}
