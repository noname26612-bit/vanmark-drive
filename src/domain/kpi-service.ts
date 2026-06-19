// Доменный сервис KPI/зарплаты (Фаза 1.5): доступ к БД, изоляция, прогон детекторов, расчёт,
// закрытие месяца снимком. Чистая арифметика и детекторы — в src/domain/kpi.ts.
// Изоляция (CLAUDE.md правило 1, ARCHITECTURE §6): расчёт водителя берёт driverId ТОЛЬКО из
// аргумента (= сессии), никогда из тела запроса. Чужой расчёт по прямой ссылке невозможен —
// нет ручки, принимающей driverId извне для роли водителя.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import {
  computePay,
  computeActBonus,
  periodBoundsUtc,
  detectLate,
  detectUnsignedDoc,
  detectMissedStop,
  dateKeyInTz,
  KPI_TZ,
  type CalcConfig,
  type CalcMark,
  type BreakdownItem,
  type ActBonusResult,
} from "./kpi";
import type { KpiMarkKind, KpiMarkStatus, PayoutFloor } from "@/generated/prisma/enums";
import type {
  MarkView,
  DriverPayrollView,
  KpiOverview,
  PayProfileView,
  KpiRuleView,
  KpiSettingsView,
} from "@/lib/kpi-dto";

export type {
  MarkView,
  DriverPayrollView,
  KpiOverview,
  PayProfileView,
  KpiRuleView,
  KpiSettingsView,
} from "@/lib/kpi-dto";

export type Actor = { id: string; role: string };

// ───────────────────────────── Хелперы ─────────────────────────────

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw Errors.validation("Период должен быть в формате YYYY-MM");
}

/**
 * Водители, участвующие в KPI/зарплате = те, у кого есть АКТИВНЫЙ денежный профиль (isActive).
 * Это единственный признак участия (CLAUDE.md: не плодим лишних флагов). Внешний перевозчик и
 * подменный водитель (Николай) профиля не имеют → исключены из детектора, кандидатов и расчёта.
 */
async function trackedDriverIds(): Promise<string[]> {
  const profiles = await prisma.driverPayProfile.findMany({ where: { isActive: true }, select: { driverId: true } });
  return profiles.map((p) => p.driverId);
}

const markInclude = {
  task: { select: { number: true, title: true } },
  driver: { select: { name: true } },
} as const;

type MarkRow = {
  id: string;
  driverId: string;
  taskId: string | null;
  period: string;
  kind: KpiMarkKind;
  status: KpiMarkStatus;
  occurredAt: Date;
  note: string | null;
  manualAmount: number | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  task: { number: number; title: string } | null;
  driver: { name: string };
};

function toMarkView(m: MarkRow): MarkView {
  return {
    id: m.id,
    driverId: m.driverId,
    driverName: m.driver.name,
    taskId: m.taskId,
    taskNumber: m.task?.number ?? null,
    taskTitle: m.task?.title ?? null,
    period: m.period,
    kind: m.kind,
    status: m.status,
    occurredAt: m.occurredAt.toISOString(),
    note: m.note,
    manualAmount: m.manualAmount,
    resolvedById: m.resolvedById,
    resolvedAt: m.resolvedAt ? m.resolvedAt.toISOString() : null,
  };
}

function toCalcMark(m: MarkRow): CalcMark {
  return { id: m.id, kind: m.kind, occurredAt: m.occurredAt, manualAmount: m.manualAmount, taskId: m.taskId, note: m.note };
}

// Полный конфиг расчёта: штрафная арифметика (CalcConfig) + параметры бонуса за комплектность (этап 15).
type KpiConfig = { calc: CalcConfig; actBonusAmount: number; actBonusThresholdPercent: number };

/** Денежные правила и настройки расчёта из БД (с дефолтами на случай неполного сида). */
async function loadKpiConfig(): Promise<KpiConfig> {
  const [rules, settings] = await Promise.all([
    prisma.kpiRule.findMany(),
    prisma.kpiSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  const weight = (kind: KpiMarkKind, def: number) => rules.find((r) => r.kind === kind)?.weight ?? def;
  return {
    calc: {
      weights: {
        LATE: weight("LATE", 500),
        UNSIGNED_DOCS: weight("UNSIGNED_DOCS", 1000),
        MISSED_STOP: weight("MISSED_STOP", 500),
      },
      progressionPercent: settings?.progressionPercent ?? 110,
      progressionStartIndex: settings?.progressionStartIndex ?? 3,
      floor: (settings?.floor as PayoutFloor) ?? "SALARY",
    },
    actBonusAmount: settings?.actBonusAmount ?? 5000,
    actBonusThresholdPercent: settings?.actBonusThresholdPercent ?? 80,
  };
}

/**
 * Счётчики комплектности актов за месяц (этап 15, PRD §12.6). База — завершённые за период задачи,
 * по которым акт фактически требуется (Task.requiresSignedDoc=true; учитывает галочку «акт не нужен»,
 * §4). Комплект — из них с приложенным подписанным актом (DOCUMENT-вложение, тот же признак, что у
 * детектора UNSIGNED_DOCS). Период — по completedAt в границах месяца (МСК).
 */
async function getActCompletenessCounts(driverId: string, period: string): Promise<{ base: number; complete: number }> {
  const { start, end } = periodBoundsUtc(period);
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: driverId,
      status: "DONE",
      requiresSignedDoc: true,
      completedAt: { gte: start, lt: end },
    },
    select: { _count: { select: { attachments: { where: { kind: "DOCUMENT" } } } } },
  });
  return { base: tasks.length, complete: tasks.filter((t) => t._count.attachments > 0).length };
}

async function listMarks(period: string, filter: { driverId?: string; status?: KpiMarkStatus } = {}): Promise<MarkView[]> {
  const marks = await prisma.kpiMark.findMany({
    where: {
      period,
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    include: markInclude,
    orderBy: { occurredAt: "asc" },
  });
  return marks.map(toMarkView);
}

async function isPeriodClosed(period: string): Promise<boolean> {
  return (await prisma.payrollStatement.count({ where: { period } })) > 0;
}

/** Расчёт одного водителя: закрытый месяц — из снимка, открытый — на лету из CONFIRMED-отметок. */
// Реконструкция бонуса за комплектность из снимка закрытого месяца (значение зафиксировано, §12.4).
// Сумма для показа берётся из снимка (начисленный value), а не из ТЕКУЩИХ настроек — иначе после
// смены настроек закрытый месяц показывал бы неисторическую сумму. missing=0 — месяц финализирован.
function snapshotActBonus(
  snap: { actBase: number; actComplete: number; actBonus: number },
  config: KpiConfig,
): ActBonusResult {
  const { actBase: base, actComplete: complete, actBonus: value } = snap;
  return {
    base,
    complete,
    percent: base > 0 ? Math.round((complete / base) * 100) : 0,
    thresholdPercent: config.actBonusThresholdPercent,
    amount: value > 0 ? value : config.actBonusAmount, // начислено → историческая сумма из снимка
    awarded: value > 0,
    value,
    requiredComplete: base > 0 ? Math.ceil((config.actBonusThresholdPercent * base) / 100) : 0,
    missing: 0, // закрытый месяц финализирован — «не хватает» не показываем
  };
}

async function buildPayroll(
  driver: { id: string; name: string },
  baseSalary: number,
  premiumBase: number,
  period: string,
  config: KpiConfig,
): Promise<DriverPayrollView> {
  const [snap, marks] = await Promise.all([
    prisma.payrollStatement.findUnique({ where: { driverId_period: { driverId: driver.id, period } } }),
    listMarks(period, { driverId: driver.id, status: "CONFIRMED" }),
  ]);
  if (snap) {
    return {
      driverId: driver.id,
      driverName: driver.name,
      period,
      closed: true,
      baseSalary: snap.baseSalary,
      premiumBase: snap.premiumBase,
      penalty: snap.penalty,
      bonus: snap.bonus,
      actBonus: snapshotActBonus(snap, config),
      premiumAfter: snap.premiumBase - snap.penalty,
      total: snap.total,
      breakdown: (snap.breakdown as unknown as BreakdownItem[]) ?? [],
      marks,
    };
  }
  const [confirmed, counts] = await Promise.all([
    prisma.kpiMark.findMany({
      where: { driverId: driver.id, period, status: "CONFIRMED" },
      include: markInclude,
      orderBy: { occurredAt: "asc" },
    }),
    getActCompletenessCounts(driver.id, period),
  ]);
  const r = computePay({ baseSalary, premiumBase, marks: confirmed.map(toCalcMark), config: config.calc });
  const actBonus = computeActBonus({
    base: counts.base,
    complete: counts.complete,
    thresholdPercent: config.actBonusThresholdPercent,
    amount: config.actBonusAmount,
  });
  return {
    driverId: driver.id,
    driverName: driver.name,
    period,
    closed: false,
    baseSalary: r.baseSalary,
    premiumBase: r.premiumBase,
    penalty: r.penalty,
    bonus: r.bonus,
    actBonus,
    premiumAfter: r.premiumAfter,
    total: r.total + actBonus.value, // бонус за комплектность — сверх формулы §12.3
    breakdown: r.breakdown,
    marks,
  };
}

// ───────────────────────────── Детектор кандидатов (cron, идемпотентный) ─────────────────────────────

/**
 * Прогон детекторов за день asOf: создаёт KpiMark со status=CANDIDATE для найденных нарушений.
 * Идемпотентно (createMany skipDuplicates по @@unique([taskId, kind])) — повторный прогон не
 * плодит дубли и не воскрешает уже отклонённые/подтверждённые отметки. Вызывается из cron (~23:30)
 * и из тестов вручную.
 */
export async function detectCandidatesForDate(
  asOf: Date = new Date(),
): Promise<{ found: number; created: number; byKind: Record<KpiMarkKind, number> }> {
  const dayKey = dateKeyInTz(asOf, KPI_TZ);
  const scheduledDay = new Date(`${dayKey}T00:00:00.000Z`); // @db.Date хранится UTC-полночью
  const dayEnd = new Date(scheduledDay.getTime() + 24 * 60 * 60 * 1000);

  // Отметки заводим только по водителям, участвующим в KPI (с денежным профилем). Задачи Николая
  // и внешнего перевозчика детектор пропускает — они вне расчёта (PRD §12, §2).
  const tracked = await trackedDriverIds();
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { in: tracked },
      OR: [{ scheduledDate: scheduledDay }, { completedAt: { gte: scheduledDay, lt: dayEnd } }],
    },
    select: {
      id: true,
      assigneeId: true,
      scheduledDate: true,
      timeTo: true,
      status: true,
      completedAt: true,
      requiresSignedDoc: true, // требование акта на уровне задачи (этап 11), не из типа
      events: { where: { toStatus: "IN_PROGRESS" }, orderBy: { at: "asc" }, take: 1, select: { at: true } }, // старт работы (этап A)
      attachments: { where: { kind: "DOCUMENT" }, take: 1, select: { id: true } },
    },
  });

  const byKind: Record<KpiMarkKind, number> = { LATE: 0, UNSIGNED_DOCS: 0, MISSED_STOP: 0, MANUAL: 0 };
  const data: {
    driverId: string;
    taskId: string;
    period: string;
    kind: KpiMarkKind;
    status: KpiMarkStatus;
    occurredAt: Date;
    note: string;
    createdById: null;
  }[] = [];

  for (const t of tasks) {
    const onSiteAt = t.events[0]?.at ?? null;
    const hasSignedDoc = t.attachments.length > 0;
    const found = [
      detectLate({ driverId: t.assigneeId, taskId: t.id, scheduledDate: t.scheduledDate, timeTo: t.timeTo, onSiteAt }),
      detectUnsignedDoc({
        driverId: t.assigneeId,
        taskId: t.id,
        requiresSignedDoc: t.requiresSignedDoc,
        status: t.status,
        completedAt: t.completedAt,
        hasSignedDoc,
      }),
      detectMissedStop({ driverId: t.assigneeId, taskId: t.id, scheduledDate: t.scheduledDate, status: t.status }, asOf),
    ];
    for (const c of found) {
      if (!c) continue;
      byKind[c.kind] += 1;
      data.push({
        driverId: c.driverId,
        taskId: c.taskId,
        period: c.period,
        kind: c.kind,
        status: "CANDIDATE",
        occurredAt: c.occurredAt,
        note: c.note,
        createdById: null,
      });
    }
  }

  const res = data.length ? await prisma.kpiMark.createMany({ data, skipDuplicates: true }) : { count: 0 };
  return { found: data.length, created: res.count, byKind };
}

/** Обёртка для node-cron (ночной прогон ~23:30, ARCHITECTURE §8). Сигнатура () => Promise<void>. */
export async function runKpiDetection(): Promise<void> {
  const r = await detectCandidatesForDate();
  console.log(`[kpi] детектор: найдено ${r.found}, создано ${r.created} кандидатов`, r.byKind);
}

// ───────────────────────────── Диспетчер: учёт и расчёт ─────────────────────────────

/** Полная картина месяца для экрана Милены: кандидаты + расчёт по каждому активному водителю. */
export async function getKpiOverview(period: string): Promise<KpiOverview> {
  assertPeriod(period);
  const [closed, allCandidates, profiles, config] = await Promise.all([
    isPeriodClosed(period),
    listMarks(period, { status: "CANDIDATE" }),
    prisma.driverPayProfile.findMany({
      where: { isActive: true },
      include: { driver: { select: { id: true, name: true } } },
    }),
    loadKpiConfig(),
  ]);
  // Показываем кандидатов только по водителям с активным профилем — отметки исторических/внешних
  // исполнителей без профиля (Николай, внешний перевозчик) не засоряют список (PRD §12, §2).
  const trackedIds = new Set(profiles.map((p) => p.driverId));
  const candidates = allCandidates.filter((c) => trackedIds.has(c.driverId));
  const ordered = profiles.sort((a, b) => a.driver.name.localeCompare(b.driver.name, "ru"));
  const drivers = await Promise.all(
    ordered.map((p) => buildPayroll({ id: p.driverId, name: p.driver.name }, p.baseSalary, p.premiumBase, period, config)),
  );
  return { period, closed, candidates, drivers };
}

/** Подтвердить/отклонить кандидата. Пока месяц открыт — можно переотметить (PRD §12.4). */
export async function resolveMark(markId: string, status: "CONFIRMED" | "DISMISSED", actor: Actor): Promise<MarkView> {
  const mark = await prisma.kpiMark.findUnique({ where: { id: markId } });
  if (!mark) throw Errors.notFound();
  if (mark.kind === "MANUAL") throw Errors.validation("Ручная отметка не требует подтверждения");
  if (await isPeriodClosed(mark.period)) throw Errors.periodClosed();
  const updated = await prisma.kpiMark.update({
    where: { id: markId },
    data: { status, resolvedById: actor.id, resolvedAt: new Date() },
    include: markInclude,
  });
  return toMarkView(updated);
}

/** Добавить ручную отметку: штраф (отрицательная сумма) или поощрение (положительная). */
export async function addManualMark(
  input: { driverId: string; amount: number; note?: string | null; period: string },
  actor: Actor,
): Promise<MarkView> {
  assertPeriod(input.period);
  if (await isPeriodClosed(input.period)) throw Errors.periodClosed();
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw Errors.validation("Сумма должна быть ненулевым целым числом (− штраф, + поощрение)");
  }
  const driver = await prisma.user.findUnique({
    where: { id: input.driverId },
    select: { id: true, role: true, payProfile: { select: { isActive: true } } },
  });
  if (!driver || driver.role !== "DRIVER") throw Errors.validation("Неизвестный водитель");
  // Ручная отметка KPI — только по водителю, участвующему в расчёте (активный денежный профиль).
  if (!driver.payProfile?.isActive) throw Errors.validation("Водитель не участвует в KPI/зарплате");
  const now = new Date();
  const created = await prisma.kpiMark.create({
    data: {
      driverId: input.driverId,
      kind: "MANUAL",
      status: "CONFIRMED",
      period: input.period,
      occurredAt: now,
      note: input.note?.trim() || null,
      manualAmount: Math.trunc(input.amount),
      createdById: actor.id,
      resolvedById: actor.id,
      resolvedAt: now,
    },
    include: markInclude,
  });
  return toMarkView(created);
}

/** Закрыть месяц: заморозить расчёт снимком PayrollStatement (неизменяем). Повторно — PERIOD_CLOSED. */
export async function closePeriod(period: string, actor: Actor): Promise<{ closed: number; period: string }> {
  assertPeriod(period);
  if (await isPeriodClosed(period)) throw Errors.periodClosed();
  const config = await loadKpiConfig();
  const profiles = await prisma.driverPayProfile.findMany({
    where: { isActive: true },
    include: { driver: { select: { id: true, name: true } } },
  });

  const rows = [];
  for (const p of profiles) {
    const [marks, counts] = await Promise.all([
      prisma.kpiMark.findMany({
        where: { driverId: p.driverId, period, status: "CONFIRMED" },
        orderBy: { occurredAt: "asc" },
      }),
      getActCompletenessCounts(p.driverId, period),
    ]);
    const r = computePay({
      baseSalary: p.baseSalary,
      premiumBase: p.premiumBase,
      marks: marks.map((m) => ({
        id: m.id,
        kind: m.kind,
        occurredAt: m.occurredAt,
        manualAmount: m.manualAmount,
        taskId: m.taskId,
        note: m.note,
      })),
      config: config.calc,
    });
    const actBonus = computeActBonus({
      base: counts.base,
      complete: counts.complete,
      thresholdPercent: config.actBonusThresholdPercent,
      amount: config.actBonusAmount,
    });
    rows.push({
      driverId: p.driverId,
      period,
      baseSalary: r.baseSalary,
      premiumBase: r.premiumBase,
      penalty: r.penalty,
      bonus: r.bonus,
      actBonus: actBonus.value,
      actBase: actBonus.base,
      actComplete: actBonus.complete,
      total: r.total + actBonus.value, // бонус за комплектность — сверх §12.3 (этап 15)
      breakdown: r.breakdown as unknown as object,
      closedById: actor.id,
    });
  }

  if (rows.length === 0) throw Errors.validation("Нет водителей с денежным профилем — закрывать нечего");
  await prisma.$transaction(rows.map((data) => prisma.payrollStatement.create({ data })));
  return { closed: rows.length, period };
}

// ───────────────────────────── Водитель: только свой расчёт (изоляция) ─────────────────────────────

/**
 * Участвует ли водитель в KPI/зарплате (есть активный денежный профиль). Для скрытия экрана
 * «Мой расчёт» у штатных не-водителей вроде Николая (PRD §2, §8): зайдя в приложение, он не должен
 * видеть пустой расчёт с нулями. driverId — только из сессии.
 */
export async function isPayrollDriver(driverId: string): Promise<boolean> {
  const profile = await prisma.driverPayProfile.findUnique({
    where: { driverId },
    select: { isActive: true },
  });
  return profile?.isActive ?? false;
}

/** Расчёт водителя. driverId приходит ТОЛЬКО из сессии — чужой расчёт получить нельзя. */
export async function getMyKpi(driverId: string, period: string): Promise<DriverPayrollView> {
  assertPeriod(period);
  const [profile, config] = await Promise.all([
    prisma.driverPayProfile.findUnique({
      where: { driverId },
      include: { driver: { select: { id: true, name: true } } },
    }),
    loadKpiConfig(),
  ]);
  const driver = profile?.driver ?? (await prisma.user.findUnique({ where: { id: driverId }, select: { id: true, name: true } }));
  if (!driver) throw Errors.notFound();
  return buildPayroll(driver, profile?.baseSalary ?? 0, profile?.premiumBase ?? 0, period, config);
}

// ───────────────────────────── Админ: денежные настройки ─────────────────────────────

export async function listPayProfiles(): Promise<PayProfileView[]> {
  const drivers = await prisma.user.findMany({
    where: { role: "DRIVER" },
    select: { id: true, name: true, login: true, payProfile: true },
    orderBy: { name: "asc" },
  });
  return drivers.map((d) => ({
    driverId: d.id,
    driverName: d.name,
    login: d.login,
    baseSalary: d.payProfile?.baseSalary ?? 0,
    premiumBase: d.payProfile?.premiumBase ?? 0,
    isActive: d.payProfile?.isActive ?? false,
  }));
}

export async function upsertPayProfile(input: {
  driverId: string;
  baseSalary: number;
  premiumBase: number;
  isActive: boolean;
}): Promise<PayProfileView> {
  const driver = await prisma.user.findUnique({ where: { id: input.driverId }, select: { id: true, role: true, name: true, login: true } });
  if (!driver || driver.role !== "DRIVER") throw Errors.validation("Профиль оплаты есть только у водителей");
  const baseSalary = Math.max(0, Math.trunc(input.baseSalary));
  const premiumBase = Math.max(0, Math.trunc(input.premiumBase));
  const saved = await prisma.driverPayProfile.upsert({
    where: { driverId: input.driverId },
    update: { baseSalary, premiumBase, isActive: input.isActive },
    create: { driverId: input.driverId, baseSalary, premiumBase, isActive: input.isActive },
  });
  return {
    driverId: driver.id,
    driverName: driver.name,
    login: driver.login,
    baseSalary: saved.baseSalary,
    premiumBase: saved.premiumBase,
    isActive: saved.isActive,
  };
}

export async function listKpiRules(): Promise<KpiRuleView[]> {
  const rules = await prisma.kpiRule.findMany();
  const order: KpiMarkKind[] = ["LATE", "MISSED_STOP", "UNSIGNED_DOCS"];
  return order.map((kind) => {
    const r = rules.find((x) => x.kind === kind);
    return { kind, weight: r?.weight ?? 0, isActive: r?.isActive ?? true };
  });
}

export async function updateKpiRule(kind: KpiMarkKind, weight: number): Promise<KpiRuleView> {
  if (kind === "MANUAL") throw Errors.validation("У ручной отметки нет веса");
  const w = Math.max(0, Math.trunc(weight));
  const saved = await prisma.kpiRule.upsert({
    where: { kind },
    update: { weight: w },
    create: { kind, weight: w, isActive: true },
  });
  return { kind: saved.kind, weight: saved.weight, isActive: saved.isActive };
}

export async function getKpiSettings(): Promise<KpiSettingsView> {
  const s = await prisma.kpiSettings.findUnique({ where: { id: "singleton" } });
  return {
    progressionPercent: s?.progressionPercent ?? 110,
    progressionStartIndex: s?.progressionStartIndex ?? 3,
    floor: (s?.floor as PayoutFloor) ?? "SALARY",
    actBonusAmount: s?.actBonusAmount ?? 5000,
    actBonusThresholdPercent: s?.actBonusThresholdPercent ?? 80,
  };
}

export async function updateKpiSettings(input: {
  progressionPercent: number;
  progressionStartIndex: number;
  floor: PayoutFloor;
  actBonusAmount: number;
  actBonusThresholdPercent: number;
}): Promise<KpiSettingsView> {
  const progressionPercent = Math.min(1000, Math.max(100, Math.trunc(input.progressionPercent))); // ≥100% (без прогрессии — 100)
  const progressionStartIndex = Math.max(1, Math.trunc(input.progressionStartIndex));
  const floor: PayoutFloor = input.floor === "ZERO" ? "ZERO" : "SALARY";
  const actBonusAmount = Math.max(0, Math.trunc(input.actBonusAmount)); // ₽; 0 — бонус выключен
  const actBonusThresholdPercent = Math.min(100, Math.max(1, Math.trunc(input.actBonusThresholdPercent))); // 1..100%
  const data = { progressionPercent, progressionStartIndex, floor, actBonusAmount, actBonusThresholdPercent };
  const saved = await prisma.kpiSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
  return {
    progressionPercent: saved.progressionPercent,
    progressionStartIndex: saved.progressionStartIndex,
    floor: saved.floor as PayoutFloor,
    actBonusAmount: saved.actBonusAmount,
    actBonusThresholdPercent: saved.actBonusThresholdPercent,
  };
}
