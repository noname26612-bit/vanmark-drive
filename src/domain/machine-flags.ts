// Индикаторы сводки станков (PRD §16.5, ARCHITECTURE §4г). Чистые функции без prisma — юнит-тесты.
//
// Осознанная граница (поправка совета): это ЛЁГКИЕ индикаторы, считаются при открытии экрана.
// Ни cron, ни пушей, ни хранимых «просрочек» здесь нет — на этапе 1 картотека не должна обрастать
// фоновой машинерией. Сроки и KPI Максима — этап 3, когда должность приживётся.
import { dateKeyInTz, utcDateKey, KPI_TZ } from "./kpi";
import { isArchivedStatus, isStockKind } from "./machine-status";
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";

/** Норматив диагностики: станок должен быть продиагностирован за один рабочий день (памятка должности). */
export const DIAGNOSIS_WORKDAYS = 1;

/** Порог сверки на площадке: не подтверждали больше недели — пора пройтись и сверить. */
export const VERIFY_STALE_DAYS = 7;

/** Горизонт «горящего» срока: дедлайн сегодня или в ближайшие 2 дня (решение Артёма 07.08). */
export const DUE_SOON_DAYS = 2;

// Потолок перебора дней: карточки бывают старыми, а точное число дней сверх порога никому не нужно.
const MAX_SCAN_DAYS = 400;

/** Выходной ли день (упрощённо: суббота/воскресенье; производственный календарь не заводим). */
export function isWeekend(dayKey: string): boolean {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Сколько рабочих дней (пн–пт) прошло СТРОГО ПОСЛЕ fromKey и ДО toKey включительно.
 * Принят в понедельник и сегодня вторник → 1. Принят в пятницу, сегодня понедельник → 1.
 */
export function workdaysBetween(fromKey: string, toKey: string): number {
  if (!fromKey || !toKey || fromKey >= toKey) return 0;
  const cur = new Date(`${fromKey}T00:00:00.000Z`);
  const end = new Date(`${toKey}T00:00:00.000Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return 0;
  let count = 0;
  for (let guard = 0; cur < end && guard < MAX_SCAN_DAYS; guard++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (!isWeekend(cur.toISOString().slice(0, 10))) count++;
  }
  return count;
}

/** Календарных дней между днями (для «давно не сверялся»). */
export function daysBetween(fromKey: string, toKey: string): number {
  if (!fromKey || !toKey) return 0;
  const from = Date.parse(`${fromKey}T00:00:00.000Z`);
  const to = Date.parse(`${toKey}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Минимум данных станка, нужный для индикаторов. */
export type FlaggableMachine = {
  kind: EquipmentKind;
  /** Всего штук на складе (складские виды). У штучного оборудования всегда 1. */
  quantity?: number;
  category: MachineCategory;
  status: MachineStatus;
  invoice1C: string | null;
  isUrgent: boolean;
  arrivedAt: Date | null;
  dueDate: Date | null;
  diagnosedAt: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
};

export type MachineFlags = {
  noInvoice1C: boolean; // клиентский станок без № заказа 1С — янтарный, НЕ блокировка
  urgent: boolean;
  awaitingDiagnosis: boolean; // принят и висит без диагностики дольше рабочего дня
  staleVerification: boolean; // давно не подтверждали, что станок физически на месте
  duePressing: boolean; // срок просрочен или горит (≤ DUE_SOON_DAYS) — см. machineDueState
};

// ─────────────────────────────── Срок готовности/выдачи ───────────────────────────────

/** Степень «горения» срока: просрочен / ближайшие DUE_SOON_DAYS дней / спокойно (нет). */
export type DueState = "overdue" | "soon" | null;

/**
 * Срок «горит» только пока станок на площадке и работа не закончена. В аренде (RENTED) станок уже
 * у клиента, в архиве — уехал совсем: там дата показывается нейтрально и в счётчики не попадает.
 */
const DUE_ACTIVE_STATUSES: ReadonlySet<MachineStatus> = new Set<MachineStatus>([
  "ACCEPTED",
  "NEEDS_REPAIR",
  "IN_REPAIR",
  "READY",
]);

/**
 * Состояние срока одного станка. Считается по МСК-дню, как остальные индикаторы. Дату принимает
 * и как Date (сервер, поле @db.Date), и как строку «YYYY-MM-DD» (клиент, DTO) — чтобы у порога
 * не завелось второй реализации на клиенте.
 */
export function machineDueState(
  m: { status: MachineStatus; dueDate: Date | string | null },
  now: Date,
  tz: string = KPI_TZ,
): DueState {
  if (m.dueDate === null || !DUE_ACTIVE_STATUSES.has(m.status)) return null;
  const dueKey = typeof m.dueDate === "string" ? m.dueDate : utcDateKey(m.dueDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueKey)) return null;
  const todayKey = dateKeyInTz(now, tz);
  if (dueKey < todayKey) return "overdue";
  return daysBetween(todayKey, dueKey) <= DUE_SOON_DAYS ? "soon" : null;
}

/**
 * Индикаторы одного станка. Архивные (выдан/продан/аннулирован) не подсвечиваются никогда:
 * станка на площадке уже нет, требовать по нему диагностику или сверку бессмысленно. Складские
 * позиции (размотчики, частотники) — тоже: это остатки, а не станки; диагностика, сверка на месте
 * и срок готовности к ним не применяются.
 */
export function machineFlags(m: FlaggableMachine, now: Date, tz: string = KPI_TZ): MachineFlags {
  if (isArchivedStatus(m.status) || isStockKind(m.kind)) {
    return {
      noInvoice1C: false,
      urgent: false,
      awaitingDiagnosis: false,
      staleVerification: false,
      duePressing: false,
    };
  }
  const todayKey = dateKeyInTz(now, tz);

  // Точка отсчёта ожидания — дата поступления; если её не заполнили, берём день заведения карточки.
  const arrivedKey = m.arrivedAt ? utcDateKey(m.arrivedAt) : dateKeyInTz(m.createdAt, tz);
  // Диагностика засчитывается только если она относится к ТЕКУЩЕМУ заезду. Иначе повторно
  // привезённый станок (карточка живёт та же, PRD §16.3) навсегда оставался бы «продиагностированным»
  // отметкой с прошлого раза, и индикатор больше никогда бы не загорелся.
  const diagnosedThisVisit =
    m.diagnosedAt !== null && dateKeyInTz(m.diagnosedAt, tz) >= arrivedKey;
  const awaitingDiagnosis =
    m.status === "ACCEPTED" &&
    !diagnosedThisVisit &&
    workdaysBetween(arrivedKey, todayKey) > DIAGNOSIS_WORKDAYS;

  // Ни разу не сверяли — считаем от дня заведения карточки (иначе новые станки сразу «протухшие»).
  const verifiedKey = m.lastVerifiedAt
    ? dateKeyInTz(m.lastVerifiedAt, tz)
    : dateKeyInTz(m.createdAt, tz);
  const staleVerification = daysBetween(verifiedKey, todayKey) > VERIFY_STALE_DAYS;

  return {
    noInvoice1C: m.category === "CLIENT" && !m.invoice1C?.trim(),
    urgent: m.isUrgent,
    awaitingDiagnosis,
    staleVerification,
    duePressing: machineDueState(m, now, tz) !== null,
  };
}

export type MachineSummary = {
  /** Активные (не архивные и не аннулированные) по категориям. */
  byCategory: Record<MachineCategory, number>;
  /** Активные по видам оборудования (станки/роликовые ножи). */
  byKind: Record<EquipmentKind, number>;
  /** Активные по состояниям. */
  byStatus: Record<MachineStatus, number>;
  total: number; // всего активных
  archived: number; // в архиве (выдан/продан), без аннулированных
  voided: number; // аннулированные — отдельно, в счётчики парка не входят
  noInvoice1C: number;
  urgent: number;
  awaitingDiagnosis: number;
  staleVerification: number;
  duePressing: number;
};

function emptyByCategory(): Record<MachineCategory, number> {
  return { CLIENT: 0, OUR_SALE: 0, OUR_RENTAL: 0 };
}

function emptyByKind(): Record<EquipmentKind, number> {
  return { MACHINE: 0, ROLLER_KNIFE: 0, SEAMER: 0, UNCOILER: 0, INVERTER: 0 };
}

function emptyByStatus(): Record<MachineStatus, number> {
  return {
    ACCEPTED: 0,
    NEEDS_REPAIR: 0,
    IN_REPAIR: 0,
    READY: 0,
    RENTED: 0,
    RELEASED: 0,
    SOLD: 0,
    VOIDED: 0,
  };
}

/**
 * Счётчики для плиток сводки. Считаются по всему парку одним проходом (десятки станков — дешевле
 * и честнее, чем несколько агрегирующих запросов, которые разъедутся между собой).
 * Аннулированные исключены из парка везде, кроме собственного счётчика (решение совета: VOIDED —
 * лечение дублей инвентаризации, он не должен раздувать статистику).
 */
export function summarize(machines: FlaggableMachine[], now: Date, tz: string = KPI_TZ): MachineSummary {
  const out: MachineSummary = {
    byCategory: emptyByCategory(),
    byKind: emptyByKind(),
    byStatus: emptyByStatus(),
    total: 0,
    archived: 0,
    voided: 0,
    noInvoice1C: 0,
    urgent: 0,
    awaitingDiagnosis: 0,
    staleVerification: 0,
    duePressing: 0,
  };

  for (const m of machines) {
    // Складские позиции живут вне состояний и категорий: в счётчике вида показываем ШТУКИ
    // («Размотчики 5»), а в парк, состояния и индикаторы они не входят вовсе.
    if (isStockKind(m.kind)) {
      out.byKind[m.kind] += m.quantity ?? 1;
      continue;
    }
    out.byStatus[m.status] += 1;
    if (m.status === "VOIDED") {
      out.voided += 1;
      continue;
    }
    if (isArchivedStatus(m.status)) {
      out.archived += 1;
      continue;
    }
    out.total += 1;
    out.byCategory[m.category] += 1;
    out.byKind[m.kind] += 1;
    const f = machineFlags(m, now, tz);
    if (f.noInvoice1C) out.noInvoice1C += 1;
    if (f.urgent) out.urgent += 1;
    if (f.awaitingDiagnosis) out.awaitingDiagnosis += 1;
    if (f.staleVerification) out.staleVerification += 1;
    if (f.duePressing) out.duePressing += 1;
  }
  return out;
}
