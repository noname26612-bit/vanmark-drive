// Доменный сервис KPI/зарплаты (Фаза 1.5): доступ к БД, изоляция, прогон детекторов, расчёт,
// закрытие месяца снимком. Чистая арифметика и детекторы — в src/domain/kpi.ts.
// Изоляция (CLAUDE.md правило 1, ARCHITECTURE §6): расчёт водителя берёт driverId ТОЛЬКО из
// аргумента (= сессии), никогда из тела запроса. Чужой расчёт по прямой ссылке невозможен —
// нет ручки, принимающей driverId извне для роли водителя.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { absenceDaysByDriver } from "./absence-service";
import { sendPushToUser } from "@/lib/push";
import { buildActViolationsPayload } from "./notifications";
import {
  computePay,
  computeActBonus,
  periodBoundsUtc,
  actDeadline,
  detectShiftLate,
  detectUnsignedDoc,
  detectMissedStop,
  dateKeyInTz,
  utcDateKey,
  KPI_TZ,
  AUTO_KINDS,
  type AutoKind,
  type CalcConfig,
  type CalcMark,
  type BreakdownItem,
  type ActBonusResult,
} from "./kpi";
import type { KpiMarkKind, KpiMarkStatus, PayoutFloor } from "@/generated/prisma/enums";
import type {
  MarkView,
  MarkDetailView,
  DriverPayrollView,
  KpiOverview,
  PayProfileView,
  KpiRuleView,
  KpiSettingsView,
} from "@/lib/kpi-dto";

export type {
  MarkView,
  MarkDetailView,
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

type PenaltyWeights = CalcConfig["weights"];

/**
 * Сумма штрафа за нарушение, ₽ (доработка №10): авто-вид — базовый тариф (вес KpiRule, без прогрессии);
 * MANUAL — manualAmount со знаком; legacy LATE и отсутствие весов → null. Это «цена нарушения» —
 * безопасно показывать диспетчеру, в отличие от итогов зарплаты.
 */
function penaltyForMark(kind: KpiMarkKind, manualAmount: number | null, weights?: PenaltyWeights): number | null {
  if (kind === "MANUAL") return manualAmount;
  if (!weights) return null;
  if (kind === "SHIFT_LATE") return weights.SHIFT_LATE;
  if (kind === "UNSIGNED_DOCS") return weights.UNSIGNED_DOCS;
  if (kind === "MISSED_STOP") return weights.MISSED_STOP;
  return null; // LATE (legacy) — тарифа нет
}

function toMarkView(m: MarkRow, weights?: PenaltyWeights): MarkView {
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
    penaltyAmount: penaltyForMark(m.kind, m.manualAmount, weights),
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
        SHIFT_LATE: weight("SHIFT_LATE", 500),
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
 * Напарник (20.07.2026, решение Артёма): where ОСОЗНАННО строго по assigneeId — парные задачи в базу
 * бонуса напарника НЕ входят (акт — зона ответственного; иначе чужая задача портила бы его долю ≥80%).
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

async function listMarks(
  period: string,
  filter: { driverId?: string; status?: KpiMarkStatus } = {},
  weights?: PenaltyWeights,
): Promise<MarkView[]> {
  const marks = await prisma.kpiMark.findMany({
    where: {
      period,
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    include: markInclude,
    orderBy: { occurredAt: "asc" },
  });
  return marks.map((m) => toMarkView(m, weights));
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
    listMarks(period, { driverId: driver.id, status: "CONFIRMED" }, config.calc.weights),
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
 * плодит дубли и не воскрешает уже отклонённые/подтверждённые отметки. Вызывается из cron
 * (полный прогон ~23:30; вечерний 20:05 — только акты, см. runActDeadlineDetection) и из тестов.
 * opts.kinds сужает прогон до части детекторов (вечером MISSED_STOP дал бы ложных кандидатов
 * по задачам, которые водитель ещё доделает).
 */
export async function detectCandidatesForDate(
  asOf: Date = new Date(),
  opts?: { kinds?: AutoKind[] },
): Promise<{ found: number; created: number; byKind: Record<KpiMarkKind, number> }> {
  const kinds = new Set<AutoKind>(opts?.kinds ?? AUTO_KINDS);
  const dayKey = dateKeyInTz(asOf, KPI_TZ);
  const scheduledDay = new Date(`${dayKey}T00:00:00.000Z`); // @db.Date хранится UTC-полночью
  const dayEnd = new Date(scheduledDay.getTime() + 24 * 60 * 60 * 1000);
  // Акты до 20:00: у задачи, завершённой после 20:00, дедлайн — 20:00 СЛЕДУЮЩЕГО дня, поэтому
  // прогон должен видеть и вчерашние завершения (окно completedAt на сутки назад).
  const completedFrom = new Date(scheduledDay.getTime() - 24 * 60 * 60 * 1000);

  // Отметки заводим только по водителям, участвующим в KPI (с денежным профилем). Задачи Николая
  // и внешнего перевозчика детектор пропускает — они вне расчёта (PRD §12, §2).
  const tracked = await trackedDriverIds();
  // Дни отпуска/больничного за этот день (№9): в них «невыполненную точку» не штрафуем.
  const absentDays = await absenceDaysByDriver(dayKey, dayKey);
  const needShifts = kinds.has("SHIFT_LATE");
  const [tasks, shifts, settings] = await Promise.all([
    prisma.task.findMany({
      where: {
        assigneeId: { in: tracked },
        OR: [{ scheduledDate: scheduledDay }, { completedAt: { gte: completedFrom, lt: dayEnd } }],
      },
      select: {
        id: true,
        assigneeId: true,
        scheduledDate: true,
        status: true,
        completedAt: true,
        requiresSignedDoc: true, // требование акта на уровне задачи (этап 11), не из типа
        actMissedReason: true, // причина водителя «завершил без акта» — в note кандидата
        // Момент приложения акта: самое раннее DOCUMENT-вложение (жёсткий дедлайн 20:00).
        attachments: {
          where: { kind: "DOCUMENT" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    // Смены за день (этап D) — для метрики «поздно открыл смену». Только подтверждённые/закрытые.
    needShifts
      ? prisma.shift.findMany({
          where: { date: scheduledDay, driverId: { in: tracked }, status: { in: ["OPEN", "CLOSED"] } },
          select: { id: true, driverId: true, openedAt: true, status: true },
        })
      : Promise.resolve([]),
    prisma.capacitySettings.findUnique({ where: { id: "singleton" } }),
  ]);
  const startMinutes = settings?.shiftStartMinutes ?? 540;
  const graceMinutes = settings?.shiftLateGraceMinutes ?? 15;

  const byKind: Record<KpiMarkKind, number> = {
    SHIFT_LATE: 0,
    LATE: 0,
    UNSIGNED_DOCS: 0,
    MISSED_STOP: 0,
    MANUAL: 0,
  };
  const data: {
    driverId: string;
    taskId: string | null;
    shiftId: string | null;
    period: string;
    kind: KpiMarkKind;
    status: KpiMarkStatus;
    occurredAt: Date;
    note: string;
    createdById: null;
  }[] = [];

  const push = (c: ReturnType<typeof detectUnsignedDoc>) => {
    if (!c) return;
    byKind[c.kind] += 1;
    data.push({
      driverId: c.driverId,
      taskId: c.taskId,
      shiftId: c.shiftId,
      period: c.period,
      kind: c.kind,
      status: "CANDIDATE",
      occurredAt: c.occurredAt,
      note: c.note,
      createdById: null,
    });
  };

  // Задачные метрики: без акта + невыполненная точка (опоздание на объект больше не детектируется — этап D).
  for (const t of tasks) {
    if (kinds.has("UNSIGNED_DOCS")) {
      push(
        detectUnsignedDoc(
          {
            driverId: t.assigneeId,
            taskId: t.id,
            requiresSignedDoc: t.requiresSignedDoc,
            status: t.status,
            completedAt: t.completedAt,
            firstDocAt: t.attachments[0]?.createdAt ?? null,
            actMissedReason: t.actMissedReason,
          },
          asOf,
        ),
      );
    }
    if (!kinds.has("MISSED_STOP")) continue;
    const missed = detectMissedStop(
      { driverId: t.assigneeId, taskId: t.id, scheduledDate: t.scheduledDate, status: t.status },
      asOf,
    );
    // В дни отпуска/больничного водителя «невыполненную точку» не штрафуем (№9, решение Артёма).
    const inAbsence =
      missed && t.assigneeId != null && t.scheduledDate != null
        ? (absentDays.get(t.assigneeId)?.has(utcDateKey(t.scheduledDate)) ?? false)
        : false;
    if (!inAbsence) push(missed);
  }

  // Метрика смены: поздно открыл смену (позже порога 9:15).
  for (const s of shifts) {
    push(
      detectShiftLate(
        { driverId: s.driverId, shiftId: s.id, openedAt: s.openedAt, status: s.status },
        startMinutes,
        graceMinutes,
      ),
    );
  }

  const res = data.length ? await prisma.kpiMark.createMany({ data, skipDuplicates: true }) : { count: 0 };
  return { found: data.length, created: res.count, byKind };
}

/** Обёртка для node-cron (ночной прогон ~23:30, ARCHITECTURE §8). Сигнатура () => Promise<void>. */
export async function runKpiDetection(): Promise<void> {
  const r = await detectCandidatesForDate();
  console.log(`[kpi] детектор: найдено ${r.found}, создано ${r.created} кандидатов`, r.byKind);
}

/**
 * Вечерний прогон «акты до 20:00» (~20:05, ARCHITECTURE §8): только UNSIGNED_DOCS — чтобы кандидаты
 * появились к вечернему обходу Милены, а MISSED_STOP не плодил ложных по задачам, которые водитель
 * ещё доделает. После прогона — пуш диспетчерам, если за сегодня есть неразобранные кандидаты по актам
 * (occurredAt = дедлайн 20:00 сегодняшнего дня).
 */
export async function runActDeadlineDetection(): Promise<void> {
  const now = new Date();
  const r = await detectCandidatesForDate(now, { kinds: ["UNSIGNED_DOCS"] });
  const dayKey = dateKeyInTz(now, KPI_TZ);
  const dayStart = new Date(`${dayKey}T00:00:00.000+03:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const todayCount = await prisma.kpiMark.count({
    where: {
      kind: "UNSIGNED_DOCS",
      status: "CANDIDATE",
      occurredAt: { gte: dayStart, lt: dayEnd },
    },
  });
  console.log(`[kpi] акты 20:00: найдено ${r.found}, создано ${r.created}, за сегодня ${todayCount}`);
  if (todayCount === 0) return;
  const dispatchers = await prisma.user.findMany({
    where: { role: "DISPATCHER", isActive: true },
    select: { id: true },
  });
  await Promise.all(dispatchers.map((u) => sendPushToUser(u.id, buildActViolationsPayload(todayCount))));
}

// ───────────────────────────── Диспетчер: учёт и расчёт ─────────────────────────────

/** Пустой бонус за акты — для карточки диспетчера, где зарплата скрыта (доработка №10). */
function emptyActBonus(): ActBonusResult {
  return {
    base: 0,
    complete: 0,
    percent: 0,
    thresholdPercent: 0,
    amount: 0,
    awarded: false,
    value: 0,
    requiredComplete: 0,
    missing: 0,
  };
}

/**
 * Карточка водителя БЕЗ зарплаты — для диспетчера (доработка №10, решение Артёма 23.06): отдаём
 * только подтверждённые нарушения с тарифами штрафов (penaltyAmount), все денежные итоги обнулены.
 * Оклад/премию из профиля даже НЕ читаем (computePay не вызывается) — зарплата физически не покидает сервер.
 */
async function buildDriverMarksOnly(
  driver: { id: string; name: string },
  period: string,
  closed: boolean,
  weights: PenaltyWeights,
): Promise<DriverPayrollView> {
  const marks = await listMarks(period, { driverId: driver.id, status: "CONFIRMED" }, weights);
  return {
    driverId: driver.id,
    driverName: driver.name,
    period,
    closed,
    baseSalary: 0,
    premiumBase: 0,
    penalty: 0,
    bonus: 0,
    actBonus: emptyActBonus(),
    premiumAfter: 0,
    total: 0,
    breakdown: [],
    marks,
  };
}

/**
 * Лайв-актуализация кандидатов (доработка №2, решение Артёма 23.06): перед показом перепроверяем
 * task-кандидатов (UNSIGNED_DOCS/MISSED_STOP) против ТЕКУЩЕГО состояния задачи тем же детектором.
 * Если нарушение больше не подтверждается (задача доведена до «Выполнено» / акт приложен ДО дедлайна
 * 20:00) — кандидата не показываем. Жёсткий дедлайн (02.07): акт, приложенный ПОСЛЕ 20:00, кандидата
 * больше не снимает — гонка «файл загрузился между 20:00 и прогоном» решается в пользу водителя по
 * createdAt вложения. SHIFT_LATE не перепроверяем (факт не исправляется задним числом).
 * Ничего не удаляем из БД: CANDIDATE-строки остаются (детектор идемпотентен, зря не воскресит), просто
 * скрываем устаревших из выдачи. Решённые вручную (CONFIRMED/DISMISSED) сюда не попадают (фильтр статуса).
 */
async function recheckTaskCandidates(candidates: MarkView[]): Promise<MarkView[]> {
  const taskIds = [
    ...new Set(
      candidates
        .filter((c) => c.taskId && (c.kind === "UNSIGNED_DOCS" || c.kind === "MISSED_STOP"))
        .map((c) => c.taskId as string),
    ),
  ];
  if (taskIds.length === 0) return candidates;
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      assigneeId: true,
      requiresSignedDoc: true,
      status: true,
      completedAt: true,
      scheduledDate: true,
      actMissedReason: true,
      attachments: {
        where: { kind: "DOCUMENT" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const asOf = new Date();
  return candidates.filter((c) => {
    if (!c.taskId || (c.kind !== "UNSIGNED_DOCS" && c.kind !== "MISSED_STOP")) return true;
    const t = byId.get(c.taskId);
    if (!t) return true; // задачи нет в выборке — не прячем по ошибке
    if (c.kind === "UNSIGNED_DOCS") {
      return (
        detectUnsignedDoc(
          {
            driverId: t.assigneeId,
            taskId: t.id,
            requiresSignedDoc: t.requiresSignedDoc,
            status: t.status,
            completedAt: t.completedAt,
            firstDocAt: t.attachments[0]?.createdAt ?? null,
            actMissedReason: t.actMissedReason,
          },
          asOf,
        ) !== null
      );
    }
    return (
      detectMissedStop(
        { driverId: t.assigneeId, taskId: t.id, scheduledDate: t.scheduledDate, status: t.status },
        asOf,
      ) !== null
    );
  });
}

/**
 * Полная картина месяца для экрана KPI. Кандидаты в нарушения — всегда (с лайв-актуализацией №2).
 * Расчёт по водителям: полная зарплата только если payrollVisible (ADMIN); для диспетчера
 * (payrollVisible=false) зарплата НЕ вычисляется и НЕ отдаётся — остаются нарушения и суммы штрафов (№10).
 */
export async function getKpiOverview(period: string, opts?: { payrollVisible?: boolean }): Promise<KpiOverview> {
  assertPeriod(period);
  const payrollVisible = opts?.payrollVisible ?? false;
  const [closed, profiles, config] = await Promise.all([
    isPeriodClosed(period),
    prisma.driverPayProfile.findMany({
      where: { isActive: true },
      include: { driver: { select: { id: true, name: true } } },
    }),
    loadKpiConfig(),
  ]);
  const weights = config.calc.weights;
  const allCandidates = await listMarks(period, { status: "CANDIDATE" }, weights);
  // Показываем кандидатов только по водителям с активным профилем — отметки исторических/внешних
  // исполнителей без профиля (Николай, внешний перевозчик) не засоряют список (PRD §12, §2).
  const trackedIds = new Set(profiles.map((p) => p.driverId));
  const trackedCandidates = allCandidates.filter((c) => trackedIds.has(c.driverId));
  // Лайв-актуализация (№2): скрыть кандидатов, которые водитель/диспетчер уже исправил.
  const candidates = await recheckTaskCandidates(trackedCandidates);
  const ordered = profiles.sort((a, b) => a.driver.name.localeCompare(b.driver.name, "ru"));
  const drivers = await Promise.all(
    ordered.map((p) =>
      payrollVisible
        ? buildPayroll({ id: p.driverId, name: p.driver.name }, p.baseSalary, p.premiumBase, period, config)
        : buildDriverMarksOnly({ id: p.driverId, name: p.driver.name }, period, closed, weights),
    ),
  );
  return { period, closed, payrollVisible, candidates, drivers };
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

/**
 * Синхронизация нарушения «без акта» при смене требования акта на задаче (решение Артёма 02.07.2026,
 * доработка «редактирование закрытых заявок» + плашка акта в карточке). Вызывается из updateTaskFields,
 * когда диспетчер меняет requiresAct. KPI правим только в ОТКРЫТОМ периоде — закрытый снимок неизменен
 * (как в resolveMark). Неподтверждённые (CANDIDATE) отдельно не трогаем: лайв-перепроверка
 * (recheckTaskCandidates) сама скрывает/возвращает их по текущему состоянию задачи, а в расчёт идут
 * только CONFIRMED. Требование акта не является гейтом завершения (CLAUDE.md §4) — это лишь метрика KPI.
 */
export async function syncUnsignedDocMark(taskId: string, actor: Actor): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      assigneeId: true,
      requiresSignedDoc: true,
      status: true,
      completedAt: true,
      actMissedReason: true,
      // Момент приложения акта: самое раннее DOCUMENT-вложение (жёсткий дедлайн 20:00, 02.07).
      attachments: {
        where: { kind: "DOCUMENT" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!task?.assigneeId) return;
  if (!(await isPayrollDriver(task.assigneeId))) return; // только водители в KPI (как детектор)

  // Дедлайн-семантика (02.07) сохраняется и здесь: снятие требования акта → null → гасим CONFIRMED;
  // акт, приложенный ПОСЛЕ 20:00, кандидата НЕ снимает; «вернули требование» до наступления дедлайна
  // кандидата не заводит — его создаст вечерний/ночной детектор, когда дедлайн пройдёт.
  const candidate = detectUnsignedDoc(
    {
      driverId: task.assigneeId,
      taskId: task.id,
      requiresSignedDoc: task.requiresSignedDoc,
      status: task.status,
      completedAt: task.completedAt,
      firstDocAt: task.attachments[0]?.createdAt ?? null,
      actMissedReason: task.actMissedReason,
    },
    new Date(),
  );
  const existing = await prisma.kpiMark.findFirst({ where: { taskId: task.id, kind: "UNSIGNED_DOCS" } });

  if (!candidate) {
    // Нарушение больше не актуально (сняли требование акта либо акт приложен): подтверждённый штраф
    // гасим в открытом периоде — он уходит из расчёта зарплаты. CANDIDATE скроет лайв-перепроверка.
    if (existing && existing.status === "CONFIRMED" && !(await isPeriodClosed(existing.period))) {
      await prisma.kpiMark.update({
        where: { id: existing.id },
        data: {
          status: "DISMISSED",
          resolvedById: actor.id,
          resolvedAt: new Date(),
          note: "Снято: акт больше не требуется",
        },
      });
    }
    return;
  }

  // Нарушение снова актуально (вернули требование, задача DONE без акта): заводим кандидата, если
  // отметки ещё нет. Существующую (в т.ч. вручную решённую) не перетираем — уважаем разбор диспетчера.
  if (!existing && !(await isPeriodClosed(candidate.period))) {
    await prisma.kpiMark.create({
      data: {
        driverId: candidate.driverId,
        taskId: candidate.taskId,
        period: candidate.period,
        kind: "UNSIGNED_DOCS",
        status: "CANDIDATE",
        occurredAt: candidate.occurredAt,
        note: candidate.note,
        createdById: null,
      },
    });
  }
}

/**
 * Детали одного нарушения для drill-down (доработка №1): разбор «почему засчиталось» — состояние
 * задачи (UNSIGNED_DOCS/MISSED_STOP), смены (SHIFT_LATE), кто завёл/разобрал. Только админ/диспетчер
 * (guard в route). Чувствительного не отдаём: по вложениям — лишь факт наличия акта, не путь к файлу.
 */
export async function getMarkDetail(markId: string): Promise<MarkDetailView> {
  const [config, capacity, mark] = await Promise.all([
    loadKpiConfig(),
    prisma.capacitySettings.findUnique({
      where: { id: "singleton" },
      select: { shiftStartMinutes: true, shiftLateGraceMinutes: true },
    }),
    prisma.kpiMark.findUnique({
      where: { id: markId },
      include: {
        task: {
          select: {
            number: true,
            title: true,
            status: true,
            scheduledDate: true,
            completedAt: true,
            requiresSignedDoc: true,
            actMissedReason: true,
            attachments: {
              where: { kind: "DOCUMENT" },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
        driver: { select: { name: true } },
        shift: { select: { date: true, openedAt: true, confirmedAt: true, status: true } },
      },
    }),
  ]);
  if (!mark) throw Errors.notFound();
  const userIds = [mark.createdById, mark.resolvedById].filter((x): x is string => !!x);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const base = toMarkView(mark, config.calc.weights);
  const t = mark.task;
  const s = mark.shift;
  const startMinutes = capacity?.shiftStartMinutes ?? 540;
  const graceMinutes = capacity?.shiftLateGraceMinutes ?? 15;
  return {
    ...base,
    taskStatus: t?.status ?? null,
    taskScheduledDate: t?.scheduledDate ? utcDateKey(t.scheduledDate) : null,
    taskCompletedAt: t?.completedAt ? t.completedAt.toISOString() : null,
    taskRequiresSignedDoc: t ? t.requiresSignedDoc : null,
    taskHasDocument: t ? t.attachments.length > 0 : null,
    // Акты до 20:00 (02.07): дедлайн, фактический момент приложения и причина водителя.
    actDeadlineAt:
      mark.kind === "UNSIGNED_DOCS" && t?.completedAt ? actDeadline(t.completedAt).toISOString() : null,
    docAttachedAt: t?.attachments[0]?.createdAt ? t.attachments[0].createdAt.toISOString() : null,
    actMissedReason: t?.actMissedReason ?? null,
    shiftDate: s?.date ? utcDateKey(s.date) : null,
    shiftOpenedAt: s?.openedAt ? s.openedAt.toISOString() : null,
    shiftConfirmedAt: s?.confirmedAt ? s.confirmedAt.toISOString() : null,
    shiftStatus: s?.status ?? null,
    shiftThresholdMinutes: mark.kind === "SHIFT_LATE" ? startMinutes + graceMinutes : null,
    createdByName: mark.createdById ? (nameById.get(mark.createdById) ?? null) : null,
    resolvedByName: mark.resolvedById ? (nameById.get(mark.resolvedById) ?? null) : null,
  };
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
  const order: KpiMarkKind[] = ["SHIFT_LATE", "MISSED_STOP", "UNSIGNED_DOCS"];
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
    monthNormHours: s?.monthNormHours ?? 176,
  };
}

export async function updateKpiSettings(input: {
  progressionPercent: number;
  progressionStartIndex: number;
  floor: PayoutFloor;
  actBonusAmount: number;
  actBonusThresholdPercent: number;
  monthNormHours: number;
}): Promise<KpiSettingsView> {
  const progressionPercent = Math.min(1000, Math.max(100, Math.trunc(input.progressionPercent))); // ≥100% (без прогрессии — 100)
  const progressionStartIndex = Math.max(1, Math.trunc(input.progressionStartIndex));
  const floor: PayoutFloor = input.floor === "ZERO" ? "ZERO" : "SALARY";
  const actBonusAmount = Math.max(0, Math.trunc(input.actBonusAmount)); // ₽; 0 — бонус выключен
  const actBonusThresholdPercent = Math.min(100, Math.max(1, Math.trunc(input.actBonusThresholdPercent))); // 1..100%
  // Нормо-часы месяца для цены часа (Сводка v2, 02.07): разумные границы 1..400 (176 = 8 ч × 22 дня).
  const monthNormHours = Math.min(400, Math.max(1, Math.trunc(input.monthNormHours)));
  const data = { progressionPercent, progressionStartIndex, floor, actBonusAmount, actBonusThresholdPercent, monthNormHours };
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
    monthNormHours: saved.monthNormHours,
  };
}
