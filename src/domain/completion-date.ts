// Дата заявки при завершении (решение Артёма 14.07.2026): заявка числится тем днём, когда
// фактически завершена. Доска/календарь/планирование/списки водителя группируют по scheduledDate,
// поэтому при DONE переносим её на МСК-день completedAt (сводка и KPI уже считают по completedAt —
// после переноса все экраны сходятся на дне закрытия). Плановая дата остаётся в журнале (TaskEvent).
// Чистая логика без prisma/IO — юнит-тестируема, как resolveAssignedDate в assign-date.ts.
import { dateKeyInTz, KPI_TZ } from "./kpi";

/**
 * Новая scheduledDate при переходе в DONE: UTC-полночь МСК-дня момента завершения.
 * `null` — переносить не надо (заявка уже числится днём завершения).
 */
export function resolveCompletionDate(
  scheduledDate: Date | null,
  completedAt: Date,
  tz: string = KPI_TZ,
): Date | null {
  const doneKey = dateKeyInTz(completedAt, tz);
  const currentKey = scheduledDate ? scheduledDate.toISOString().slice(0, 10) : null;
  if (currentKey === doneKey) return null;
  return new Date(`${doneKey}T00:00:00.000Z`);
}

/** Дата @db.Date (UTC-полночь) → «ДД.ММ.ГГГГ» для текста события в журнале. */
export function formatDayRu(d: Date | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.toISOString().slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}
