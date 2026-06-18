// Доменный сервис «Сводки по водителям» (Фаза 2): доступ к БД и сборка метрик за период.
// Только чтение — статусную матрицу, журнал и изоляцию не трогает. Доступ к ручке — диспетчер/админ
// (гейт в route handler). Период — ПО ДАТЕ ЗАКРЫТИЯ задачи; отмены/переносы — по журналу событий.
// Чистая арифметика окна периода — в src/domain/summary.ts.
import { prisma } from "@/lib/prisma";
import { dateKeyInTz, KPI_TZ } from "./kpi";
import {
  assertGranularity,
  normalizeAnchor,
  windowKeys,
  coarseUtcRange,
  inWindow,
  averageMinutes,
  type Granularity,
} from "./summary";
import type { DriverSummaryView, SummaryOverview, SummaryTotals, TypeBreakdown } from "@/lib/summary-dto";

export type { DriverSummaryView, SummaryOverview, SummaryTotals } from "@/lib/summary-dto";

type Acc = {
  done: number;
  repair: number;
  delivery: number;
  byType: Map<string, TypeBreakdown>;
  late: number;
  missed: number;
  cancelled: number;
  rescheduled: number;
  durations: number[]; // длительности «На месте → Выполнено» в мс
};

function emptyAcc(): Acc {
  return { done: 0, repair: 0, delivery: 0, byType: new Map(), late: 0, missed: 0, cancelled: 0, rescheduled: 0, durations: [] };
}

/**
 * Сводка по всем активным водителям за окно периода (день/неделя/месяц от якоря anchorRaw).
 * Метрики из уже накопленных данных: выполненные задачи (Task.completedAt), подтверждённые
 * нарушения KPI (KpiMark CONFIRMED), отмены/переносы (TaskEvent). Чужие роли не попадают —
 * аккумулятор заведён только по водителям из listActiveDrivers.
 */
export async function getDriverSummary(granularity: string, anchorRaw: string): Promise<SummaryOverview> {
  assertGranularity(granularity);
  const anchor = normalizeAnchor(granularity, anchorRaw);
  const w = windowKeys(granularity, anchor);
  const range = coarseUtcRange(w);

  const [drivers, doneTasks, marks, statusEvents] = await Promise.all([
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.task.findMany({
      where: { status: "DONE", assigneeId: { not: null }, completedAt: { gte: range.gte, lt: range.lt } },
      select: {
        assigneeId: true,
        completedAt: true,
        type: { select: { id: true, name: true, requiresSignedDoc: true } },
        events: { where: { toStatus: "ON_SITE" }, orderBy: { at: "asc" }, take: 1, select: { at: true } },
      },
    }),
    prisma.kpiMark.findMany({
      where: { kind: { in: ["LATE", "MISSED_STOP"] }, status: "CONFIRMED", occurredAt: { gte: range.gte, lt: range.lt } },
      select: { driverId: true, kind: true, occurredAt: true },
    }),
    prisma.taskEvent.findMany({
      where: { toStatus: { in: ["CANCELLED", "RESCHEDULED"] }, at: { gte: range.gte, lt: range.lt } },
      select: { at: true, toStatus: true, task: { select: { assigneeId: true } } },
    }),
  ]);

  const acc = new Map<string, Acc>();
  for (const d of drivers) acc.set(d.id, emptyAcc());

  // Выполненные задачи: точная принадлежность окну — по дате закрытия в московской зоне.
  for (const t of doneTasks) {
    if (!t.assigneeId || !t.completedAt) continue;
    const a = acc.get(t.assigneeId);
    if (!a) continue; // не активный водитель — в сводку не входит
    if (!inWindow(dateKeyInTz(t.completedAt, KPI_TZ), w)) continue;
    a.done += 1;
    if (t.type.requiresSignedDoc) a.repair += 1;
    else a.delivery += 1;
    const bt = a.byType.get(t.type.id);
    if (bt) bt.count += 1;
    else a.byType.set(t.type.id, { typeId: t.type.id, typeName: t.type.name, isRepair: t.type.requiresSignedDoc, count: 1 });
    const onSiteAt = t.events[0]?.at;
    if (onSiteAt) {
      const ms = t.completedAt.getTime() - onSiteAt.getTime();
      if (ms > 0) a.durations.push(ms); // отрицательные/нулевые (кривые данные) не учитываем
    }
  }

  // Подтверждённые нарушения KPI.
  for (const m of marks) {
    const a = acc.get(m.driverId);
    if (!a) continue;
    if (!inWindow(dateKeyInTz(m.occurredAt, KPI_TZ), w)) continue;
    if (m.kind === "LATE") a.late += 1;
    else if (m.kind === "MISSED_STOP") a.missed += 1;
  }

  // Отмены/переносы — по журналу (write-only, надёжнее updatedAt). Привязка к текущему исполнителю задачи.
  for (const e of statusEvents) {
    const driverId = e.task.assigneeId;
    if (!driverId) continue; // событие по неназначенной задаче — не к водителю
    const a = acc.get(driverId);
    if (!a) continue;
    if (!inWindow(dateKeyInTz(e.at, KPI_TZ), w)) continue;
    if (e.toStatus === "CANCELLED") a.cancelled += 1;
    else if (e.toStatus === "RESCHEDULED") a.rescheduled += 1;
  }

  const driverViews: DriverSummaryView[] = drivers.map((d) => {
    const a = acc.get(d.id)!;
    const byType = [...a.byType.values()].sort((x, y) => y.count - x.count || x.typeName.localeCompare(y.typeName, "ru"));
    return {
      driverId: d.id,
      driverName: d.name,
      doneCount: a.done,
      repairCount: a.repair,
      deliveryCount: a.delivery,
      byType,
      lateCount: a.late,
      missedStopCount: a.missed,
      cancelledCount: a.cancelled,
      rescheduledCount: a.rescheduled,
      avgOnSiteMinutes: averageMinutes(a.durations),
    };
  });

  const totals: SummaryTotals = {
    doneCount: sum(driverViews, (d) => d.doneCount),
    repairCount: sum(driverViews, (d) => d.repairCount),
    deliveryCount: sum(driverViews, (d) => d.deliveryCount),
    lateCount: sum(driverViews, (d) => d.lateCount),
    missedStopCount: sum(driverViews, (d) => d.missedStopCount),
    cancelledCount: sum(driverViews, (d) => d.cancelledCount),
    rescheduledCount: sum(driverViews, (d) => d.rescheduledCount),
    avgOnSiteMinutes: averageMinutes([...acc.values()].flatMap((a) => a.durations)),
  };

  return { granularity: granularity as Granularity, anchor, fromKey: w.fromKey, toKey: w.toKey, drivers: driverViews, totals };
}

function sum<T>(items: T[], pick: (x: T) => number): number {
  return items.reduce((s, x) => s + pick(x), 0);
}
