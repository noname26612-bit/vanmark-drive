// Индикаторы сводки станков (PRD §16.5, ARCHITECTURE §4г). Чистые функции без prisma — юнит-тесты.
//
// Осознанная граница (поправка совета): это ЛЁГКИЕ индикаторы, считаются при открытии экрана.
// Ни cron, ни пушей, ни хранимых «просрочек» здесь нет — на этапе 1 картотека не должна обрастать
// фоновой машинерией. Сроки и KPI Максима — этап 3, когда должность приживётся.
import { dateKeyInTz, utcDateKey, KPI_TZ } from "./kpi";
import { isArchivedStatus, isStockKind } from "./machine-status";
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";

/** Горизонт «горящего» срока: дедлайн сегодня или в ближайшие 2 дня (решение Артёма 07.08). */
export const DUE_SOON_DAYS = 2;

/** Календарных дней между днями (для сроков). */
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
  categories: MachineCategory[];
  status: MachineStatus;
  isUrgent: boolean;
  dueDate: Date | null;
  diagnosedAt: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
};

export type MachineFlags = {
  urgent: boolean;
  awaitingDiagnosis: boolean; // диагностику ни разу не отмечали (или отметку сняли после аренды)
  notVerified: boolean; // не подтверждали, что станок физически на месте
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
 * Индикаторы одного станка.
 *
 * ДИАГНОСТИКА И СВЕРКА (переделано 20.08.2026 вместе с баннером в карточке). Раньше здесь стояли
 * пороги «рабочий день без диагностики» и «неделя без сверки» — то есть индикатор загорался сам
 * собой по календарю, и погасить его было нечем, кроме как сходить и отметить. Артём переформулировал
 * задачу: это не «просрочка», а ОБЯЗАТЕЛЬНАЯ ОПЕРАЦИЯ, которую делают один раз — когда станок завели
 * или когда он вернулся из аренды. Значит и признак простой: отметки нет — индикатор горит, отметка
 * есть — не горит. Ровно то же условие показывает баннер в карточке, и они не могут разойтись.
 *
 * Отметки сбрасываются сервером при возврате из аренды (src/domain/machine-service.ts) — именно
 * поэтому здесь больше не нужно сравнивать дату отметки с датой заезда.
 *
 * Кто не подсвечивается никогда: архивные (выдан/продан/аннулирован) — станка на площадке уже нет;
 * складские остатки (размотчики, частотники) — это не станки; и станки В АРЕНДЕ — они у клиента,
 * подтверждать их наличие на площадке и осматривать некому.
 */
export function machineFlags(m: FlaggableMachine, now: Date, tz: string = KPI_TZ): MachineFlags {
  if (isArchivedStatus(m.status) || isStockKind(m.kind)) {
    return {
      urgent: false,
      awaitingDiagnosis: false,
      notVerified: false,
      duePressing: false,
    };
  }
  const onSite = m.status !== "RENTED";

  return {
    urgent: m.isUrgent,
    awaitingDiagnosis: onSite && m.diagnosedAt === null,
    notVerified: onSite && m.lastVerifiedAt === null,
    duePressing: machineDueState(m, now, tz) !== null,
  };
}

export type MachineSummary = {
  /**
   * Активные (не архивные и не аннулированные) по категориям. Станок с двумя категориями
   * считается в ОБЕИХ, поэтому сумма по категориям может быть больше `total` — это не ошибка,
   * а прямое следствие того, что один станок правда стоит и на продажу, и в аренду.
   */
  byCategory: Record<MachineCategory, number>;
  /** Активные по видам оборудования (станки/роликовые ножи). */
  byKind: Record<EquipmentKind, number>;
  /** Активные по состояниям. */
  byStatus: Record<MachineStatus, number>;
  total: number; // всего активных
  archived: number; // в архиве (выдан/продан), без аннулированных
  voided: number; // аннулированные — отдельно, в счётчики парка не входят
  urgent: number;
  awaitingDiagnosis: number;
  notVerified: number;
  duePressing: number;
};

function emptyByCategory(): Record<MachineCategory, number> {
  return { CLIENT: 0, OUR_SALE: 0, OUR_RENTAL: 0, SHOWROOM: 0, KNIFE_SETUP: 0 };
}

function emptyByKind(): Record<EquipmentKind, number> {
  return { MACHINE: 0, ROLLER_KNIFE: 0, FALZ_MACHINE: 0, SEAMER: 0, UNCOILER: 0, INVERTER: 0 };
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
    urgent: 0,
    awaitingDiagnosis: 0,
    notVerified: 0,
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
    // Станок считается в КАЖДОЙ своей категории: он и правда стоит и на продажу, и в аренду,
    // а плитка «Наш арендный» должна показывать всё, что можно сдать.
    for (const c of m.categories) out.byCategory[c] += 1;
    out.byKind[m.kind] += 1;
    const f = machineFlags(m, now, tz);
    if (f.urgent) out.urgent += 1;
    if (f.awaitingDiagnosis) out.awaitingDiagnosis += 1;
    if (f.notVerified) out.notVerified += 1;
    if (f.duePressing) out.duePressing += 1;
  }
  return out;
}
