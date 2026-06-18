// ЯДРО «Сводки по водителям» (Фаза 2) — чистые функции без доступа к БД: окно периода
// (день/неделя/месяц), нормализация/сдвиг якорной даты, попадание в окно, среднее время.
// Покрыто unit-тестами (summary.test.ts). Доступ к БД и сборка метрик — в summary-service.ts.
// Период считается ПО ДАТЕ ЗАКРЫТИЯ задачи; границы — в московской зоне (как KPI, см. kpi.ts).
import { Errors } from "./errors";
import { formatDate, formatDateShort, formatPeriod } from "@/lib/task-ui";

// Разрез периода. anchor — любой день внутри окна в формате YYYY-MM-DD (ключ дня).
export type Granularity = "day" | "week" | "month";
export const GRANULARITIES: Granularity[] = ["day", "week", "month"];

export function isGranularity(v: string): v is Granularity {
  return v === "day" || v === "week" || v === "month";
}

export function assertGranularity(v: string): asserts v is Granularity {
  if (!isGranularity(v)) throw Errors.validation("Разрез должен быть day, week или month");
}

const DATE_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function assertDateKey(key: string): void {
  if (!DATE_KEY.test(key) || Number.isNaN(Date.parse(`${key}T00:00:00.000Z`))) {
    throw Errors.validation("Дата должна быть в формате YYYY-MM-DD");
  }
}

// ───────────────────────────── Календарная арифметика над ключом дня ─────────────────────────────
// Работаем со строками YYYY-MM-DD через UTC-полночь: календарная дата и день недели от зоны не зависят.

/** Сдвиг ключа дня на n суток. */
function dayShift(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** День недели ключа: 0 = понедельник … 6 = воскресенье. */
function weekdayMon0(key: string): number {
  return (new Date(`${key}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** Первый день месяца ключа (YYYY-MM-01). */
function monthFirst(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** Последний день месяца ключа. */
function monthLast(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // день 0 след. месяца = последний день текущего
}

/** Понедельник недели, содержащей ключ. */
function weekStart(key: string): string {
  return dayShift(key, -weekdayMon0(key));
}

// ───────────────────────────── Окно периода ─────────────────────────────

export type Window = { fromKey: string; toKey: string };

/** Нормализовать якорь к началу окна: для недели — понедельник, для месяца — 1-е число, для дня — сам день. */
export function normalizeAnchor(granularity: Granularity, anchor: string): string {
  assertDateKey(anchor);
  if (granularity === "week") return weekStart(anchor);
  if (granularity === "month") return monthFirst(anchor);
  return anchor;
}

/** Границы окна [fromKey..toKey] (включительно) по разрезу и якорю. */
export function windowKeys(granularity: Granularity, anchor: string): Window {
  assertDateKey(anchor);
  if (granularity === "day") return { fromKey: anchor, toKey: anchor };
  if (granularity === "week") {
    const from = weekStart(anchor);
    return { fromKey: from, toKey: dayShift(from, 6) };
  }
  return { fromKey: monthFirst(anchor), toKey: monthLast(anchor) };
}

/** Сдвиг окна на delta шагов (день → сутки, неделя → 7 суток, месяц → календарный месяц). */
export function shiftAnchor(granularity: Granularity, anchor: string, delta: number): string {
  assertDateKey(anchor);
  if (granularity === "day") return dayShift(anchor, delta);
  if (granularity === "week") return dayShift(weekStart(anchor), delta * 7);
  const [y, m] = anchor.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** Попадает ли ключ дня в окно (границы включительно). Строковое сравнение ISO-дат корректно. */
export function inWindow(dateKey: string, w: Window): boolean {
  return dateKey >= w.fromKey && dateKey <= w.toKey;
}

/** Грубый UTC-диапазон выборки из БД (с суточным запасом с каждой стороны под сдвиг зоны).
 *  Точная принадлежность окну — потом через dateKeyInTz + inWindow. */
export function coarseUtcRange(w: Window): { gte: Date; lt: Date } {
  return {
    gte: new Date(`${dayShift(w.fromKey, -1)}T00:00:00.000Z`),
    lt: new Date(`${dayShift(w.toKey, 2)}T00:00:00.000Z`),
  };
}

/** Среднее в минутах по списку длительностей в мс (пустой список → null, без деления на ноль). */
export function averageMinutes(durationsMs: number[]): number | null {
  if (durationsMs.length === 0) return null;
  const sum = durationsMs.reduce((a, b) => a + b, 0);
  return Math.round(sum / durationsMs.length / 60000);
}

/** Человекочитаемый заголовок периода: «14.06.2026» / «08.06 – 14.06.2026» / «июнь 2026». */
export function formatWindowLabel(granularity: Granularity, anchor: string): string {
  const w = windowKeys(granularity, anchor);
  if (granularity === "day") return formatDate(w.fromKey);
  if (granularity === "month") return formatPeriod(w.fromKey.slice(0, 7));
  return `${formatDateShort(w.fromKey)} – ${formatDate(w.toKey)}`;
}
