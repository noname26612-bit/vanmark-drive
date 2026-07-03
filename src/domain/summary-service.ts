// Доменный сервис «Сводки по водителям» (Фаза 2 → v2, решение Артёма 02.07): доступ к БД и сборка
// метрик за период. Только чтение — статусную матрицу, журнал и изоляцию не трогает. Доступ к
// ручкам — диспетчер/админ (гейт в route handler). Период — ПО ДАТЕ ЗАКРЫТИЯ задачи; отмены/переносы —
// по журналу событий. Чистая арифметика окна периода — в src/domain/summary.ts.
// v2: разбивка по типам работ убрана; добавлены занятость по дням, план/факт времени (оценка vs факт),
// зафиксированный простой (пометки) и «Деньги за период». Рублёвые метрики от оклада (простой в ₽)
// считаются ТОЛЬКО при payrollVisible (ADMIN) — диспетчеру сервер отдаёт null (решение №10).
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { dateKeyInTz, utcDateKey, KPI_TZ } from "./kpi";
import {
  assertGranularity,
  normalizeAnchor,
  windowKeys,
  windowDayKeys,
  coarseUtcRange,
  inWindow,
  averageMinutes,
  loadPercent,
  idleCostRub,
  type Granularity,
} from "./summary";
import type {
  DriverSummaryView,
  DriverDayLoad,
  SummaryOverview,
  SummaryTotals,
  SummaryMoney,
  SummaryDetailMetric,
  SummaryDetailRow,
  CarrierSummary,
  CarrierTaskRow,
  ShiftHistoryRow,
} from "@/lib/summary-dto";

export type {
  DriverSummaryView,
  SummaryOverview,
  SummaryTotals,
  SummaryMoney,
  SummaryDetailMetric,
  SummaryDetailRow,
  CarrierSummary,
} from "@/lib/summary-dto";

type Acc = {
  done: number;
  late: number;
  missed: number;
  cancelled: number;
  rescheduled: number;
  durations: number[]; // длительности «В работе → Завершено» в мс (этап A: старт работы — IN_PROGRESS)
  shiftMs: number; // суммарная длина закрытых смен периода, мс (этап D) — для простоя
  dayWorkedMs: Map<string, number>; // по дням окна: отработано, мс (мини-график v2)
  dayShiftMs: Map<string, number>; // по дням окна: длительность смен, мс
  planMin: number; // Σ оценок (estimatedMinutes) по задачам с оценкой И фактом (план/факт v2)
  factMin: number; // Σ факта по тем же задачам
  planFactCount: number;
  idleNotedMin: number; // зафиксированный Миленой простой (пометки), мин (v2)
};

function emptyAcc(): Acc {
  return {
    done: 0,
    late: 0,
    missed: 0,
    cancelled: 0,
    rescheduled: 0,
    durations: [],
    shiftMs: 0,
    dayWorkedMs: new Map(),
    dayShiftMs: new Map(),
    planMin: 0,
    factMin: 0,
    planFactCount: 0,
    idleNotedMin: 0,
  };
}

function bump(map: Map<string, number>, key: string, ms: number): void {
  map.set(key, (map.get(key) ?? 0) + ms);
}

/**
 * Сводка по всем активным водителям за окно периода (день/неделя/месяц от якоря anchorRaw).
 * Метрики из уже накопленных данных: выполненные задачи (Task.completedAt), подтверждённые
 * нарушения KPI (KpiMark CONFIRMED), отмены/переносы (TaskEvent), закрытые смены, пометки о простое.
 * opts.payrollVisible=true (ADMIN) добавляет рублёвую цену простоя (от оклада) — иначе null (№10).
 */
export async function getDriverSummary(
  granularity: string,
  anchorRaw: string,
  opts?: { payrollVisible?: boolean },
): Promise<SummaryOverview> {
  assertGranularity(granularity);
  const payrollVisible = opts?.payrollVisible ?? false;
  const anchor = normalizeAnchor(granularity, anchorRaw);
  const w = windowKeys(granularity, anchor);
  const range = coarseUtcRange(w);
  const dayKeys = windowDayKeys(w);

  const [drivers, doneTasks, marks, statusEvents, shifts, idleNotes, paidTasks, pricedWorkTasks] =
    await Promise.all([
      prisma.user.findMany({
        where: { role: "DRIVER", isActive: true },
        select: { id: true, name: true, isExternal: true },
        orderBy: { name: "asc" },
      }),
      prisma.task.findMany({
        where: { status: "DONE", assigneeId: { not: null }, completedAt: { gte: range.gte, lt: range.lt } },
        select: {
          assigneeId: true,
          completedAt: true,
          estimatedMinutes: true, // план/факт (v2)
          carrierCost: true, // затраты на внешних — в «Деньги за период» (v2)
          assignee: { select: { isExternal: true } },
          events: { where: { toStatus: "IN_PROGRESS" }, orderBy: { at: "asc" }, take: 1, select: { at: true } },
        },
      }),
      prisma.kpiMark.findMany({
        where: { kind: { in: ["SHIFT_LATE", "MISSED_STOP"] }, status: "CONFIRMED", occurredAt: { gte: range.gte, lt: range.lt } },
        select: { driverId: true, kind: true, occurredAt: true },
      }),
      prisma.taskEvent.findMany({
        where: { toStatus: { in: ["CANCELLED", "RESCHEDULED"] }, at: { gte: range.gte, lt: range.lt } },
        select: { at: true, toStatus: true, task: { select: { assigneeId: true } } },
      }),
      // Закрытые смены периода (этап D) — для простоя. Грубый range по дню смены, точное окно ниже.
      prisma.shift.findMany({
        where: { status: "CLOSED", closedAt: { not: null }, date: { gte: range.gte, lt: range.lt } },
        select: { driverId: true, date: true, openedAt: true, closedAt: true },
      }),
      // Пометки о простое (v2): «зафиксированный простой» отдельной метрикой.
      prisma.driverIdleNote.findMany({
        where: { date: { gte: range.gte, lt: range.lt } },
        select: { driverId: true, date: true, minutes: true },
      }),
      // Деньги (v2): полученные оплаты «на месте».
      prisma.task.findMany({
        where: { status: "DONE", paymentReceived: true, completedAt: { gte: range.gte, lt: range.lt } },
        select: { completedAt: true, paymentAmount: true },
      }),
      // Деньги (v2): расценённые работы (ведомости PRICED/SIGNED) по задачам, закрытым в окне.
      prisma.task.findMany({
        where: {
          status: "DONE",
          worksheetStatus: { in: ["PRICED", "SIGNED"] },
          completedAt: { gte: range.gte, lt: range.lt },
        },
        select: { completedAt: true, workItems: { select: { price: true, quantity: true } } },
      }),
    ]);

  const acc = new Map<string, Acc>();
  for (const d of drivers) acc.set(d.id, emptyAcc());

  let carrierCostTotal = 0;

  // Выполненные задачи: точная принадлежность окну — по дате закрытия в московской зоне.
  for (const t of doneTasks) {
    if (!t.assigneeId || !t.completedAt) continue;
    const a = acc.get(t.assigneeId);
    if (!a) continue; // не активный водитель — в сводку не входит
    const dk = dateKeyInTz(t.completedAt, KPI_TZ);
    if (!inWindow(dk, w)) continue;
    a.done += 1;
    if (t.assignee?.isExternal && t.carrierCost) carrierCostTotal += t.carrierCost;
    const startedAt = t.events[0]?.at; // первый переход в «В работе» (этап A; раньше — «На месте»)
    if (startedAt) {
      const ms = t.completedAt.getTime() - startedAt.getTime();
      if (ms > 0) {
        a.durations.push(ms); // отрицательные/нулевые (кривые данные) не учитываем
        bump(a.dayWorkedMs, dk, ms); // занятость по дням (v2): отработанное — к дню закрытия
        // План/факт (v2): только задачи, где есть И оценка, И факт — честное сравнение.
        if (t.estimatedMinutes != null && t.estimatedMinutes > 0) {
          a.planMin += t.estimatedMinutes;
          a.factMin += Math.round(ms / 60000);
          a.planFactCount += 1;
        }
      }
    }
  }

  // Подтверждённые нарушения KPI.
  for (const m of marks) {
    const a = acc.get(m.driverId);
    if (!a) continue;
    if (!inWindow(dateKeyInTz(m.occurredAt, KPI_TZ), w)) continue;
    if (m.kind === "SHIFT_LATE") a.late += 1;
    else if (m.kind === "MISSED_STOP") a.missed += 1;
  }

  // Длина закрытых смен в окне (этап D) — знаменатель для простоя и загрузки.
  for (const s of shifts) {
    if (!s.closedAt) continue;
    const a = acc.get(s.driverId);
    if (!a) continue;
    const dk = utcDateKey(s.date);
    if (!inWindow(dk, w)) continue;
    const ms = s.closedAt.getTime() - s.openedAt.getTime();
    if (ms > 0) {
      a.shiftMs += ms;
      bump(a.dayShiftMs, dk, ms);
    }
  }

  // Зафиксированный простой (пометки Милены, v2).
  for (const n of idleNotes) {
    const a = acc.get(n.driverId);
    if (!a) continue;
    if (!inWindow(utcDateKey(n.date), w)) continue;
    a.idleNotedMin += n.minutes;
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
    // Отработано = сумма времени по задачам (В работе → Завершено); простой = смены − отработано (этап D).
    const workedMinutes = Math.round(a.durations.reduce((s, x) => s + x, 0) / 60000);
    const shiftMinutes = Math.round(a.shiftMs / 60000);
    const idleMinutes = Math.max(0, shiftMinutes - workedMinutes);
    const days: DriverDayLoad[] = dayKeys.map((k) => ({
      dateKey: k,
      workedMinutes: Math.round((a.dayWorkedMs.get(k) ?? 0) / 60000),
      shiftMinutes: Math.round((a.dayShiftMs.get(k) ?? 0) / 60000),
    }));
    return {
      driverId: d.id,
      driverName: d.name,
      isExternal: d.isExternal,
      doneCount: a.done,
      lateCount: a.late,
      missedStopCount: a.missed,
      cancelledCount: a.cancelled,
      rescheduledCount: a.rescheduled,
      avgOnSiteMinutes: averageMinutes(a.durations),
      workedMinutes,
      idleMinutes,
      shiftMinutes,
      loadPercent: loadPercent(workedMinutes, shiftMinutes),
      days,
      planMinutes: a.planMin,
      factMinutes: a.factMin,
      planFactCount: a.planFactCount,
      idleNotedMinutes: a.idleNotedMin,
    };
  });

  const totals: SummaryTotals = {
    doneCount: sum(driverViews, (d) => d.doneCount),
    lateCount: sum(driverViews, (d) => d.lateCount),
    missedStopCount: sum(driverViews, (d) => d.missedStopCount),
    cancelledCount: sum(driverViews, (d) => d.cancelledCount),
    rescheduledCount: sum(driverViews, (d) => d.rescheduledCount),
    avgOnSiteMinutes: averageMinutes([...acc.values()].flatMap((a) => a.durations)),
    workedMinutes: sum(driverViews, (d) => d.workedMinutes),
    idleMinutes: sum(driverViews, (d) => d.idleMinutes),
    shiftMinutes: sum(driverViews, (d) => d.shiftMinutes),
    loadPercent: loadPercent(
      sum(driverViews, (d) => d.workedMinutes),
      sum(driverViews, (d) => d.shiftMinutes),
    ),
    planMinutes: sum(driverViews, (d) => d.planMinutes),
    factMinutes: sum(driverViews, (d) => d.factMinutes),
    idleNotedMinutes: sum(driverViews, (d) => d.idleNotedMinutes),
  };

  // Деньги за период (v2). Точная принадлежность окну — по МСК-дате закрытия.
  const paymentsReceived = paidTasks
    .filter((t) => t.completedAt && inWindow(dateKeyInTz(t.completedAt, KPI_TZ), w))
    .reduce((s, t) => s + (t.paymentAmount ?? 0), 0);
  const pricedWorks = pricedWorkTasks
    .filter((t) => t.completedAt && inWindow(dateKeyInTz(t.completedAt, KPI_TZ), w))
    .reduce((s, t) => s + t.workItems.reduce((ws, i) => ws + (i.price ?? 0) * i.quantity, 0), 0);

  // Цена простоя от оклада — ТОЛЬКО админу (№10): у диспетчера окладов на сервере не считаем вовсе.
  let idleCost: number | null = null;
  let idleNotedCost: number | null = null;
  if (payrollVisible) {
    const [profiles, settings] = await Promise.all([
      prisma.driverPayProfile.findMany({ where: { isActive: true }, select: { driverId: true, baseSalary: true } }),
      prisma.kpiSettings.findUnique({ where: { id: "singleton" }, select: { monthNormHours: true } }),
    ]);
    const norm = settings?.monthNormHours ?? 176;
    const salaryById = new Map(profiles.map((p) => [p.driverId, p.baseSalary]));
    idleCost = 0;
    idleNotedCost = 0;
    for (const d of driverViews) {
      const salary = salaryById.get(d.driverId);
      if (!salary) continue; // без денежного профиля цену часа не посчитать (Николай, внешний)
      idleCost += idleCostRub(d.idleMinutes, salary, norm);
      idleNotedCost += idleCostRub(d.idleNotedMinutes, salary, norm);
    }
  }

  const money: SummaryMoney = {
    paymentsReceived,
    pricedWorks,
    receivedTotal: paymentsReceived + pricedWorks,
    carrierCost: carrierCostTotal,
    idleCost,
    idleNotedCost,
  };

  return {
    granularity: granularity as Granularity,
    anchor,
    fromKey: w.fromKey,
    toKey: w.toKey,
    payrollVisible,
    drivers: driverViews,
    totals,
    money,
  };
}

function sum<T>(items: T[], pick: (x: T) => number): number {
  return items.reduce((s, x) => s + pick(x), 0);
}

// ─── Drill-down (v2): список задач/смен/пометок за цифрой Сводки ───

const DETAIL_METRICS = new Set<SummaryDetailMetric>([
  "done",
  "late",
  "missed",
  "cancelled",
  "rescheduled",
  "idle-notes",
  "plan-fact",
  "payments",
  "priced-works",
  "carrier",
  "shifts",
]);

/**
 * Детализация метрики Сводки тем же окном и теми же фильтрами, что и агрегат (цифра и список не
 * должны расходиться). driverId сужает до одного водителя (клик в его карточке). Объёмы малы
 * (3 водителя, 10–30 задач/день) — списки грузятся лениво по клику. Гейт — в route (диспетчер/админ).
 */
export async function getSummaryDetails(
  metric: string,
  granularity: string,
  anchorRaw: string,
  driverId?: string,
): Promise<SummaryDetailRow[]> {
  if (!DETAIL_METRICS.has(metric as SummaryDetailMetric)) throw Errors.validation("Неизвестная метрика");
  assertGranularity(granularity);
  const anchor = normalizeAnchor(granularity, anchorRaw);
  const w = windowKeys(granularity, anchor);
  const range = coarseUtcRange(w);
  const m = metric as SummaryDetailMetric;

  if (m === "done" || m === "plan-fact" || m === "carrier" || m === "payments" || m === "priced-works") {
    const rows = await prisma.task.findMany({
      where: {
        status: "DONE",
        completedAt: { gte: range.gte, lt: range.lt },
        ...(m === "carrier" ? { assignee: { isExternal: true } } : {}),
        ...(m === "payments" ? { paymentReceived: true } : {}),
        ...(m === "priced-works" ? { worksheetStatus: { in: ["PRICED", "SIGNED"] } } : {}),
        ...(driverId ? { assigneeId: driverId } : { assigneeId: { not: null } }),
      },
      select: {
        id: true,
        number: true,
        title: true,
        completedAt: true,
        estimatedMinutes: true,
        paymentAmount: true,
        carrierCost: true,
        assignee: { select: { name: true } },
        workItems: m === "priced-works" ? { select: { price: true, quantity: true } } : false,
        events:
          m === "done" || m === "plan-fact"
            ? { where: { toStatus: "IN_PROGRESS" }, orderBy: { at: "asc" }, take: 1, select: { at: true } }
            : false,
      },
      orderBy: [{ completedAt: "asc" }],
    });
    const out: SummaryDetailRow[] = [];
    for (const t of rows) {
      if (!t.completedAt) continue;
      const dk = dateKeyInTz(t.completedAt, KPI_TZ);
      if (!inWindow(dk, w)) continue;
      const startedAt = "events" in t && t.events?.[0]?.at ? t.events[0].at : null;
      const factMin = startedAt ? Math.round((t.completedAt.getTime() - startedAt.getTime()) / 60000) : null;
      if (m === "plan-fact") {
        // Те же условия, что в агрегате: есть и оценка, и положительный факт.
        if (t.estimatedMinutes == null || t.estimatedMinutes <= 0 || factMin == null || factMin <= 0) continue;
      }
      const base: SummaryDetailRow = {
        taskId: t.id,
        number: t.number,
        title: t.title,
        dateKey: dk,
        driverName: t.assignee?.name,
      };
      if (m === "done") out.push({ ...base, minutes: factMin ?? undefined });
      else if (m === "plan-fact")
        out.push({ ...base, minutes: factMin ?? undefined, extra: `план ${t.estimatedMinutes} мин → факт ${factMin} мин` });
      else if (m === "payments") out.push({ ...base, amount: t.paymentAmount ?? 0 });
      else if (m === "carrier") out.push({ ...base, amount: t.carrierCost ?? undefined });
      else if (m === "priced-works") {
        const total = ("workItems" in t ? (t.workItems ?? []) : []).reduce(
          (s, i) => s + (i.price ?? 0) * i.quantity,
          0,
        );
        out.push({ ...base, amount: total });
      }
    }
    return out;
  }

  if (m === "late" || m === "missed") {
    const rows = await prisma.kpiMark.findMany({
      where: {
        kind: m === "late" ? "SHIFT_LATE" : "MISSED_STOP",
        status: "CONFIRMED",
        occurredAt: { gte: range.gte, lt: range.lt },
        ...(driverId ? { driverId } : {}),
      },
      select: {
        occurredAt: true,
        note: true,
        driver: { select: { name: true } },
        task: { select: { id: true, number: true, title: true } },
      },
      orderBy: { occurredAt: "asc" },
    });
    return rows
      .filter((r) => inWindow(dateKeyInTz(r.occurredAt, KPI_TZ), w))
      .map((r) => ({
        taskId: r.task?.id,
        number: r.task?.number,
        title: r.task?.title ?? r.note ?? (m === "late" ? "Поздно открыл смену" : "Невыполненная точка"),
        dateKey: dateKeyInTz(r.occurredAt, KPI_TZ),
        driverName: r.driver.name,
        extra: r.task && r.note ? r.note : undefined,
      }));
  }

  if (m === "cancelled" || m === "rescheduled") {
    const rows = await prisma.taskEvent.findMany({
      where: {
        toStatus: m === "cancelled" ? "CANCELLED" : "RESCHEDULED",
        at: { gte: range.gte, lt: range.lt },
        ...(driverId ? { task: { assigneeId: driverId } } : { task: { assigneeId: { not: null } } }),
      },
      select: {
        at: true,
        comment: true,
        task: { select: { id: true, number: true, title: true, assignee: { select: { name: true } } } },
      },
      orderBy: { at: "asc" },
    });
    return rows
      .filter((r) => inWindow(dateKeyInTz(r.at, KPI_TZ), w))
      .map((r) => ({
        taskId: r.task.id,
        number: r.task.number,
        title: r.task.title,
        dateKey: dateKeyInTz(r.at, KPI_TZ),
        driverName: r.task.assignee?.name,
        extra: r.comment ?? undefined,
      }));
  }

  if (m === "idle-notes") {
    const rows = await prisma.driverIdleNote.findMany({
      where: { date: { gte: range.gte, lt: range.lt }, ...(driverId ? { driverId } : {}) },
      select: { date: true, minutes: true, note: true, driver: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    return rows
      .filter((r) => inWindow(utcDateKey(r.date), w))
      .map((r) => ({
        title: r.note ?? "Пометка о простое",
        dateKey: utcDateKey(r.date),
        driverName: r.driver.name,
        minutes: r.minutes,
      }));
  }

  // shifts: закрытые смены окна — «за минутами смен/простоя».
  const rows = await prisma.shift.findMany({
    where: {
      status: "CLOSED",
      closedAt: { not: null },
      date: { gte: range.gte, lt: range.lt },
      ...(driverId ? { driverId } : {}),
    },
    select: { date: true, openedAt: true, closedAt: true, driver: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  return rows
    .filter((r) => inWindow(utcDateKey(r.date), w))
    .map((r) => {
      const minutes = r.closedAt ? Math.max(0, Math.round((r.closedAt.getTime() - r.openedAt.getTime()) / 60000)) : 0;
      const hhmm = (d: Date) =>
        d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: KPI_TZ });
      return {
        title: `Смена ${hhmm(r.openedAt)}–${r.closedAt ? hhmm(r.closedAt) : "…"}`,
        dateKey: utcDateKey(r.date),
        driverName: r.driver.name,
        minutes,
      };
    });
}

/**
 * История смен за окно периода (№3, 03.07): журнал смен с временами открытия/закрытия и пометками
 * правок — для показа и инлайн-правки в «Сводке». Все статусы (не только закрытые): открытую смену
 * тоже можно поправить/увидеть. Только чтение; правка — через PATCH /api/shifts/:id. Гейт Д/А — в route.
 * Свежие сверху (по дате, затем по времени открытия).
 */
export async function getShiftHistory(
  granularity: string,
  anchorRaw: string,
  driverId?: string,
): Promise<ShiftHistoryRow[]> {
  assertGranularity(granularity);
  const anchor = normalizeAnchor(granularity, anchorRaw);
  const w = windowKeys(granularity, anchor);
  const range = coarseUtcRange(w);
  const rows = await prisma.shift.findMany({
    where: { date: { gte: range.gte, lt: range.lt }, ...(driverId ? { driverId } : {}) },
    select: {
      id: true,
      driverId: true,
      date: true,
      status: true,
      openedAt: true,
      closedAt: true,
      openedAtAdjustNote: true,
      closedAtAdjustNote: true,
      driver: { select: { name: true } },
    },
    orderBy: [{ date: "desc" }, { openedAt: "desc" }],
  });
  return rows
    .filter((r) => inWindow(utcDateKey(r.date), w))
    .map((r) => ({
      id: r.id,
      driverId: r.driverId,
      driverName: r.driver.name,
      dateKey: utcDateKey(r.date),
      status: r.status,
      openedAt: r.openedAt.toISOString(),
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      openedAtAdjustNote: r.openedAtAdjustNote,
      closedAtAdjustNote: r.closedAtAdjustNote,
      shiftMinutes: r.closedAt
        ? Math.max(0, Math.round((r.closedAt.getTime() - r.openedAt.getTime()) / 60000))
        : null,
    }));
}

/**
 * Затраты на внешних перевозчиков за окно периода (этап 3, 02.07): завершённые задачи исполнителей
 * с User.isExternal, стоимость — Task.carrierCost. Период по completedAt (как вся Сводка) —
 * незавершённые задачи в отчёт не попадают. Только чтение; гейт диспетчер/админ — в route.
 */
export async function getCarrierSummary(granularity: string, anchorRaw: string): Promise<CarrierSummary> {
  assertGranularity(granularity);
  const anchor = normalizeAnchor(granularity, anchorRaw);
  const w = windowKeys(granularity, anchor);
  const range = coarseUtcRange(w);
  const rows = await prisma.task.findMany({
    where: {
      status: "DONE",
      completedAt: { gte: range.gte, lt: range.lt },
      assignee: { isExternal: true },
    },
    select: {
      id: true,
      number: true,
      title: true,
      completedAt: true,
      carrierCost: true,
      assignee: { select: { name: true } },
    },
    orderBy: [{ completedAt: "asc" }],
  });
  const tasks: CarrierTaskRow[] = [];
  for (const t of rows) {
    if (!t.completedAt) continue;
    const dateKey = dateKeyInTz(t.completedAt, KPI_TZ);
    if (!inWindow(dateKey, w)) continue; // точная принадлежность окну — по МСК-дате закрытия
    tasks.push({
      taskId: t.id,
      number: t.number,
      title: t.title,
      dateKey,
      cost: t.carrierCost,
      driverName: t.assignee?.name ?? "—",
    });
  }
  const priced = tasks.filter((t) => t.cost != null);
  const totalCost = sum(priced, (t) => t.cost ?? 0);
  return {
    granularity: granularity as Granularity,
    anchor,
    fromKey: w.fromKey,
    toKey: w.toKey,
    taskCount: tasks.length,
    pricedCount: priced.length,
    totalCost,
    avgCost: priced.length ? Math.round(totalCost / priced.length) : null,
    tasks,
  };
}
