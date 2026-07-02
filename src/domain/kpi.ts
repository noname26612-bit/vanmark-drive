// ЯДРО KPI (Фаза 1.5) — чистые функции без доступа к БД: утилиты времени/периода, детекторы
// трёх нарушений и прогрессивный расчёт зарплаты. Покрыто unit-тестами (kpi.test.ts).
// Продукт — PRD §12, модель — ARCHITECTURE §4а. Доступ к БД и изоляция — в kpi-service.ts.
import type { KpiMarkKind, ShiftStatus } from "@/generated/prisma/enums";

// Таймзона расчёта дат/периодов. Совпадает с cron (ARCHITECTURE §8). Москва — фиксированный UTC+3.
export const KPI_TZ = process.env.CRON_TZ ?? "Europe/Moscow";

// Виды авто-нарушений (детектируются системой). MANUAL — отдельный ручной вид, не детектируется.
// Этап D: «опоздание на объект» (LATE, legacy) заменено на «поздно открыл смену» (SHIFT_LATE).
export type AutoKind = "SHIFT_LATE" | "UNSIGNED_DOCS" | "MISSED_STOP";
export const AUTO_KINDS: AutoKind[] = ["SHIFT_LATE", "UNSIGNED_DOCS", "MISSED_STOP"];

export function isAutoKind(kind: KpiMarkKind): kind is AutoKind {
  return kind === "SHIFT_LATE" || kind === "UNSIGNED_DOCS" || kind === "MISSED_STOP";
}

// ───────────────────────────── Время и период ─────────────────────────────

/** Стенные часы момента в таймзоне tz: календарная дата (YYYY-MM-DD) и минуты от полуночи. */
function wallParts(instant: Date, tz: string): { dateKey: string; minutes: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00";
  let hour = get("hour");
  if (hour === "24") hour = "00"; // некоторые рантаймы дают 24 для полуночи
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(hour) * 60 + Number(get("minute")),
  };
}

/** Календарная дата момента (YYYY-MM-DD) в таймзоне tz. */
export function dateKeyInTz(instant: Date, tz: string = KPI_TZ): string {
  return wallParts(instant, tz).dateKey;
}

/** Месяц начисления «YYYY-MM» момента в таймзоне tz. */
export function periodOf(instant: Date, tz: string = KPI_TZ): string {
  return dateKeyInTz(instant, tz).slice(0, 7);
}

/** Календарная дата @db.Date (хранится UTC-полночью) как YYYY-MM-DD — без сдвига по зоне. */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Границы месяца «YYYY-MM» как UTC-моменты [start, end) — для выборки задач по completedAt.
 * Москва фиксированный UTC+3 (как и весь модуль KPI), поэтому локальная полночь = `...+03:00`.
 * Согласовано с periodOf(): задача попадает в период ⇔ её completedAt в [start, end).
 */
export function periodBoundsUtc(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: new Date(`${y}-${pad(m)}-01T00:00:00.000+03:00`),
    end: new Date(`${ny}-${pad(nm)}-01T00:00:00.000+03:00`),
  };
}

/** Полдень UTC указанного календарного дня — безопасный «момент дня» вдали от границ зоны. */
export function noonUtc(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

/** «HH:MM» (в т.ч. внутри «до 17:00») → минуты от полуночи; нечитаемое/невалидное → null. */
export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// ───────────────────────────── Детекторы нарушений ─────────────────────────────

export type Candidate = {
  kind: AutoKind;
  driverId: string;
  taskId: string | null; // привязка к задаче (UNSIGNED_DOCS/MISSED_STOP)
  shiftId: string | null; // привязка к смене (SHIFT_LATE)
  occurredAt: Date;
  period: string;
  note: string;
};

const FINAL_FOR_MISSED = new Set(["DONE", "CANCELLED", "RESCHEDULED"]);

/** Поздно открыл смену (этап D, PRD §12.1): фактическое время открытия (openedAt) позже порога
 *  «начало рабочего дня + запас» (по умолчанию 9:15). Считается только по ПОДТВЕРЖДЁННОЙ смене
 *  (диспетчер подтвердил приход) — REQUESTED пропускаем. Заменяет прежнее «опоздание на объект». */
export type ShiftLateInput = {
  driverId: string;
  shiftId: string;
  openedAt: Date;
  status: ShiftStatus;
};

export function detectShiftLate(
  s: ShiftLateInput,
  startMinutes: number,
  graceMinutes: number,
  tz: string = KPI_TZ,
): Candidate | null {
  if (s.status === "REQUESTED") return null; // приход не подтверждён диспетчером — пока не штрафуем
  const w = wallParts(s.openedAt, tz);
  if (w.minutes <= startMinutes + graceMinutes) return null;
  const hh = Math.floor(w.minutes / 60);
  const mm = w.minutes % 60;
  return {
    kind: "SHIFT_LATE",
    driverId: s.driverId,
    taskId: null,
    shiftId: s.shiftId,
    occurredAt: s.openedAt,
    period: periodOf(s.openedAt, tz),
    note: `Поздно открыл смену (${hh}:${String(mm).padStart(2, "0")})`,
  };
}

// ─── Без акта: дедлайн 20:00 (решение Артёма 02.07, PRD §12.1) ───

/** Дедлайн приложения акта: 20:00 МСК. Минуты от полуночи стенных часов. */
export const ACT_DEADLINE_MINUTES = 20 * 60;

/** Следующий календарный день для ключа YYYY-MM-DD (через полдень UTC — вдали от границ зоны). */
function nextDateKey(dateKey: string): string {
  const d = noonUtc(dateKey);
  d.setUTCDate(d.getUTCDate() + 1);
  return utcDateKey(d);
}

/**
 * Момент дедлайна акта для задачи, завершённой в completedAt: 20:00 того же календарного дня (МСК).
 * Завершена в 20:00 и позже — дедлайн переносится на 20:00 следующего дня (иначе нарушение возникало
 * бы в самый момент завершения, без шанса приложить акт). Москва — фиксированный UTC+3, как во всём
 * модуле (см. periodBoundsUtc).
 */
export function actDeadline(completedAt: Date, tz: string = KPI_TZ): Date {
  const w = wallParts(completedAt, tz);
  const dayKey = w.minutes >= ACT_DEADLINE_MINUTES ? nextDateKey(w.dateKey) : w.dateKey;
  const hh = String(Math.floor(ACT_DEADLINE_MINUTES / 60)).padStart(2, "0");
  const mm = String(ACT_DEADLINE_MINUTES % 60).padStart(2, "0");
  return new Date(`${dayKey}T${hh}:${mm}:00.000+03:00`);
}

/**
 * Без акта: актовая задача завершена, а акт не приложен до дедлайна 20:00. Дедлайн ЖЁСТКИЙ
 * (решение Артёма 02.07): смотрим МОМЕНТ приложения (firstDocAt) — акт после 20:00 нарушение
 * не снимает (Милена может отклонить кандидата вручную). До наступления дедлайна нарушения нет.
 */
export type UnsignedDocInput = {
  driverId: string | null;
  taskId: string;
  requiresSignedDoc: boolean;
  status: string;
  completedAt: Date | null;
  firstDocAt: Date | null; // createdAt самого раннего вложения kind=DOCUMENT; null — акта нет
  actMissedReason?: string | null; // причина водителя при завершении без акта — только для note
};

export function detectUnsignedDoc(t: UnsignedDocInput, asOf: Date, tz: string = KPI_TZ): Candidate | null {
  if (!t.driverId) return null;
  if (!t.requiresSignedDoc) return null; // метрика только для актовых типов
  if (t.status !== "DONE") return null; // нарушение фиксируется по завершённой задаче
  if (!t.completedAt) return null; // без момента завершения дедлайн не построить (DONE всегда ставит completedAt)
  const deadline = actDeadline(t.completedAt, tz);
  if (asOf < deadline) return null; // дедлайн ещё не наступил — не спешим
  if (t.firstDocAt && t.firstDocAt <= deadline) return null; // акт приложен вовремя
  // occurredAt = дедлайн (детерминированно): повторные прогоны дают тот же момент и период.
  return {
    kind: "UNSIGNED_DOCS",
    driverId: t.driverId,
    taskId: t.taskId,
    shiftId: null,
    occurredAt: deadline,
    period: periodOf(deadline, tz),
    note:
      "Акт не приложен до 20:00" +
      (t.actMissedReason ? ` · Причина водителя: ${t.actMissedReason}` : ""),
  };
}

/** Невыполненная точка: назначенная на наступивший день задача не доведена до DONE
 *  (без переноса/отмены). PRD §12.1. asOf — момент прогона детектора (обычно ~23:30). */
export type MissedStopInput = {
  driverId: string | null;
  taskId: string;
  scheduledDate: Date | null;
  status: string;
};

export function detectMissedStop(t: MissedStopInput, asOf: Date, tz: string = KPI_TZ): Candidate | null {
  if (!t.driverId || !t.scheduledDate) return null; // без даты «точки дня» нет
  const dayKey = utcDateKey(t.scheduledDate);
  if (dayKey > dateKeyInTz(asOf, tz)) return null; // день ещё не наступил
  if (FINAL_FOR_MISSED.has(t.status)) return null; // доведена/перенесена/отменена — не нарушение
  const occurredAt = noonUtc(dayKey);
  return {
    kind: "MISSED_STOP",
    driverId: t.driverId,
    taskId: t.taskId,
    shiftId: null,
    occurredAt,
    period: dayKey.slice(0, 7),
    note: "Точка дня не доведена до «Выполнено»",
  };
}

// ───────────────────────────── Прогрессивный расчёт ─────────────────────────────

export type KpiWeights = Record<AutoKind, number>;

export type CalcConfig = {
  weights: KpiWeights;
  progressionPercent: number; // шаг прогрессии, % (110 = ×1.10)
  progressionStartIndex: number; // с какого по счёту нарушения месяца включается прогрессия
  floor: "SALARY" | "ZERO"; // нижний порог итога
};

export type CalcMark = {
  id?: string;
  kind: KpiMarkKind;
  occurredAt: Date;
  manualAmount?: number | null; // только MANUAL: знаковая сумма (− штраф, + поощрение)
  taskId?: string | null;
  note?: string | null;
};

export type BreakdownItem = {
  markId?: string;
  kind: KpiMarkKind;
  taskId?: string | null;
  occurredAt: string; // ISO
  order: number | null; // порядковый номер штрафуемого нарушения месяца (для прогрессии)
  baseWeight: number | null; // вес до прогрессии (для авто-видов)
  multiplier: number | null; // множитель прогрессии
  amount: number; // знаковая сумма ₽: штраф < 0, поощрение > 0
  note?: string | null;
};

export type PayResult = {
  baseSalary: number;
  premiumBase: number;
  penalty: number; // сумма штрафов, положительное число
  bonus: number; // сумма ручных поощрений, положительное число
  premiumAfter: number; // премия после штрафов (может быть отрицательной — для отображения)
  total: number; // итог к выплате (не ниже нижнего порога)
  breakdown: BreakdownItem[];
};

/** Множитель прогрессии для нарушения с порядковым номером index (1-based). До startIndex
 *  множитель = 1.0, затем растёт геометрически с шагом percent. */
export function progressionMultiplier(index: number, percent: number, startIndex: number): number {
  const exponent = Math.max(0, index - (startIndex - 1));
  return Math.pow(percent / 100, exponent);
}

/** Сортировка отметок по времени возникновения (затем по id) — для устойчивой прогрессии. */
function byOccurrence(a: CalcMark, b: CalcMark): number {
  const d = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (d !== 0) return d;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

/**
 * Итог = Оклад + (Премия − прогрессивные штрафы) + ручные поощрения (PRD §12.3).
 * floor=SALARY (решение Артёма): штрафы максимум обнуляют премию, итог не ниже оклада.
 * floor=ZERO (историческое): премия может уйти в минус, итог не ниже 0.
 */
export function computePay(input: {
  baseSalary: number;
  premiumBase: number;
  marks: CalcMark[];
  config: CalcConfig;
}): PayResult {
  const { baseSalary, premiumBase, config } = input;
  const breakdown: BreakdownItem[] = [];

  // 1. Штрафуемые авто-нарушения, по порядку возникновения → прогрессивный штраф.
  const weighted = input.marks.filter((m) => isAutoKind(m.kind)).sort(byOccurrence);
  let penalty = 0;
  weighted.forEach((m, i) => {
    const order = i + 1;
    const base = config.weights[m.kind as AutoKind];
    const multiplier = progressionMultiplier(order, config.progressionPercent, config.progressionStartIndex);
    const amount = Math.round(base * multiplier);
    penalty += amount;
    breakdown.push({
      markId: m.id,
      kind: m.kind,
      taskId: m.taskId ?? null,
      occurredAt: m.occurredAt.toISOString(),
      order,
      baseWeight: base,
      multiplier,
      amount: -amount,
      note: m.note ?? null,
    });
  });

  // 2. Ручные отметки: положительная сумма — поощрение, отрицательная — ручной штраф.
  let bonus = 0;
  for (const m of input.marks.filter((x) => x.kind === "MANUAL").sort(byOccurrence)) {
    const amount = m.manualAmount ?? 0;
    if (amount >= 0) bonus += amount;
    else penalty += -amount;
    breakdown.push({
      markId: m.id,
      kind: m.kind,
      taskId: m.taskId ?? null,
      occurredAt: m.occurredAt.toISOString(),
      order: null,
      baseWeight: null,
      multiplier: null,
      amount,
      note: m.note ?? null,
    });
  }

  // 3. Сборка итога с учётом нижнего порога.
  const premiumAfter = premiumBase - penalty;
  const total =
    config.floor === "SALARY"
      ? baseSalary + Math.max(0, premiumAfter) + bonus
      : Math.max(0, baseSalary + premiumAfter + bonus);

  return { baseSalary, premiumBase, penalty, bonus, premiumAfter, total, breakdown };
}

// ───────────────────────────── Бонус за комплектность актов (этап 15, PRD §12.6) ─────────────────────────────

export type ActBonusInput = {
  base: number; // завершённые за месяц задачи, по которым акт фактически требуется (знаменатель)
  complete: number; // из них с приложенным подписанным актом (числитель)
  thresholdPercent: number; // порог комплектности, % (по умолчанию 80)
  amount: number; // сумма бонуса, ₽ (по умолчанию 5000)
};

export type ActBonusResult = {
  base: number;
  complete: number;
  percent: number; // округлённый процент для показа (display-only)
  thresholdPercent: number;
  amount: number; // настроенная сумма бонуса (эхо конфига)
  awarded: boolean; // начислен ли бонус
  value: number; // фактически начислено: awarded ? amount : 0
  requiredComplete: number; // сколько актов нужно для порога при текущей базе
  missing: number; // сколько ещё актов не хватает до порога (0, если начислен или база=0)
};

/**
 * Бонус за комплектность актов (PRD §12.6): если доля задач с приложенным актом ≥ порога — +amount.
 * База = 0 (за месяц нет актовых задач) → бонус не начисляется (нейтрально, без штрафа).
 * Сравнение с порогом — точное (целочисленное), без потери на округлении: complete/base ≥ threshold/100.
 */
export function computeActBonus(i: ActBonusInput): ActBonusResult {
  const base = Math.max(0, Math.trunc(i.base));
  const complete = Math.max(0, Math.min(base, Math.trunc(i.complete)));
  const threshold = Math.max(0, Math.trunc(i.thresholdPercent));
  const amount = Math.max(0, Math.trunc(i.amount));
  const percent = base > 0 ? Math.round((complete / base) * 100) : 0;
  // requiredComplete = ⌈threshold·base/100⌉; complete ≥ requiredComplete ⇔ complete/base ≥ threshold/100.
  const requiredComplete = base > 0 ? Math.ceil((threshold * base) / 100) : 0;
  const awarded = base > 0 && complete >= requiredComplete;
  const missing = awarded || base === 0 ? 0 : Math.max(0, requiredComplete - complete);
  return {
    base,
    complete,
    percent,
    thresholdPercent: threshold,
    amount,
    awarded,
    value: awarded ? amount : 0,
    requiredComplete,
    missing,
  };
}
