// Доменный сервис смен водителя (этап C, переработка механики). Открытие/подтверждение/закрытие.
// Изоляция (CLAUDE.md правило 1, ARCHITECTURE §6): для водителя driverId берётся ТОЛЬКО из сессии
// (аргумент), никогда из тела запроса. Подтверждение, список смен и правка времени — только диспетчер/
// админ (гейт в route handler). Учёт отработанного/простоя по сменам — этап D, из openedAt/closedAt.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { detectShiftLate, periodOf, parseHHMM, dateKeyInTz, KPI_TZ } from "./kpi";
import type { ShiftStatus } from "@/generated/prisma/enums";

export type Actor = { id: string; role: string };

export type ShiftView = {
  id: string;
  driverId: string;
  driverName: string | null;
  date: string; // YYYY-MM-DD (локальный день смены)
  status: ShiftStatus;
  openedAt: string; // ISO — фактическое (актуальное, возможно скорректированное) начало
  // Корректировка времени открытия (№3): исходное время и факт правки — для показа «время скорректировано».
  openedAtReported: string | null; // что нажал водитель (если правили), иначе null
  openedAtAdjustedAt: string | null;
  openedAtAdjustNote: string | null;
  confirmedAt: string | null;
  closedAt: string | null;
  // Отработано за день по задачам (В работе → Завершено + текущая активная), мин — для полосы на
  // «Сегодня» (№5). Заполняется только в listShiftsForDate; в одиночных ответах не нужно.
  workedMinutes?: number;
};

type ShiftRow = {
  id: string;
  driverId: string;
  date: Date;
  status: ShiftStatus;
  openedAt: Date;
  openedAtReported: Date | null;
  openedAtAdjustedAt: Date | null;
  openedAtAdjustNote: string | null;
  confirmedAt: Date | null;
  closedAt: Date | null;
  driver?: { name: string } | null;
};

// YYYY-MM-DD → Date в UTC-полночь (@db.Date хранит только дату). Совпадает с конвенцией задач.
function parseDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Errors.validation("Некорректная дата");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw Errors.validation("Некорректная дата");
  return d;
}

function toView(s: ShiftRow): ShiftView {
  return {
    id: s.id,
    driverId: s.driverId,
    driverName: s.driver?.name ?? null,
    date: s.date.toISOString().slice(0, 10),
    status: s.status,
    openedAt: s.openedAt.toISOString(),
    openedAtReported: s.openedAtReported ? s.openedAtReported.toISOString() : null,
    openedAtAdjustedAt: s.openedAtAdjustedAt ? s.openedAtAdjustedAt.toISOString() : null,
    openedAtAdjustNote: s.openedAtAdjustNote,
    confirmedAt: s.confirmedAt ? s.confirmedAt.toISOString() : null,
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
  };
}

/** Смена водителя на день (или null). driverId — ТОЛЬКО из сессии. */
export async function getMyShift(driverId: string, today: string): Promise<ShiftView | null> {
  const date = parseDate(today);
  const shift = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  return shift ? toView(shift) : null;
}

/** День смены вычисляется на СЕРВЕРЕ из текущего момента в МСК (preflight-аудит В2): клиентскому
 *  `today` не доверяем — иначе подделанная/сбитая зона телефона пишет смену не на тот день и обходит
 *  штраф «поздно открыл» (детектор SHIFT_LATE и учёт простоя выбирают смены по date). Открытие/закрытие
 *  смены и так online-only (PRD §15), серверное время доступно. */
function serverShiftDate(): Date {
  return parseDate(dateKeyInTz(new Date(), KPI_TZ));
}

/**
 * Открыть смену (водитель). Фиксирует фактическое начало рабочего дня = момент нажатия. Повторное
 * открытие в тот же день — идемпотентно (возвращаем текущую смену, не пересоздаём и не сдвигаем время).
 */
export async function openShift(driverId: string): Promise<ShiftView> {
  const date = serverShiftDate();
  const existing = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  if (existing) return toView(existing);
  const created = await prisma.shift.create({
    data: { driverId, date, status: "REQUESTED", openedAt: new Date() },
  });
  return toView(created);
}

/** Закрыть смену (водитель). Допустимо из REQUESTED и OPEN. Повторное закрытие — идемпотентно. */
export async function closeShift(driverId: string): Promise<ShiftView> {
  const date = serverShiftDate();
  const shift = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  if (!shift) throw Errors.notFound();
  if (shift.status === "CLOSED") return toView(shift);
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  return toView(updated);
}

// Возврат закрытой смены в рабочее состояние: подтверждённую → OPEN, неподтверждённую → REQUESTED.
// closedAt снимаем (смена снова идёт). openedAt НЕ трогаем — поэтому штраф «поздно открыл» (SHIFT_LATE,
// по openedAt) и учёт отработанного (по задачам) остаются корректными, миграция БД не нужна.
function reopenedStatus(confirmedAt: Date | null): ShiftStatus {
  return confirmedAt ? "OPEN" : "REQUESTED";
}

/**
 * Переоткрыть смену водителем (на случай случайного закрытия). driverId — ТОЛЬКО из сессии, смена за
 * серверный день. Идемпотентно: если смена не закрыта — возвращаем как есть.
 */
export async function reopenShift(driverId: string): Promise<ShiftView> {
  const date = serverShiftDate();
  const shift = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  if (!shift) throw Errors.notFound();
  if (shift.status !== "CLOSED") return toView(shift);
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { status: reopenedStatus(shift.confirmedAt), closedAt: null },
  });
  return toView(updated);
}

/**
 * Переоткрыть смену диспетчером/админом по id (кнопка на доске). Гейт роли (диспетчер/админ) — в route
 * handler. Идемпотентно: если смена не закрыта — возвращаем как есть.
 */
export async function reopenShiftById(shiftId: string): Promise<ShiftView> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { driver: { select: { name: true } } },
  });
  if (!shift) throw Errors.notFound();
  if (shift.status !== "CLOSED") return toView(shift);
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { status: reopenedStatus(shift.confirmedAt), closedAt: null },
    include: { driver: { select: { name: true } } },
  });
  return toView(updated);
}

/** Закрыт ли месяц расчёта (есть снимок PayrollStatement) — правка времени тогда запрещена. */
async function isPeriodClosed(period: string): Promise<boolean> {
  return (await prisma.payrollStatement.count({ where: { period } })) > 0;
}

/**
 * Синхронизировать авто-отметку «поздно открыл смену» (SHIFT_LATE) после правки времени открытия (№3).
 * Идемпотентно: по новому времени либо заводим/обновляем кандидата, либо убираем устаревшего.
 * Решённые вручную (CONFIRMED/DISMISSED) НЕ трогаем — это решение диспетчера. Только в открытом месяце.
 */
async function syncShiftLate(shift: { id: string; driverId: string; openedAt: Date; status: ShiftStatus }): Promise<void> {
  const settings = await prisma.capacitySettings.findUnique({
    where: { id: "singleton" },
    select: { shiftStartMinutes: true, shiftLateGraceMinutes: true },
  });
  const startMin = settings?.shiftStartMinutes ?? 540;
  const grace = settings?.shiftLateGraceMinutes ?? 15;
  const cand = detectShiftLate(
    { driverId: shift.driverId, shiftId: shift.id, openedAt: shift.openedAt, status: shift.status },
    startMin,
    grace,
  );
  const existing = await prisma.kpiMark.findUnique({
    where: { shiftId_kind: { shiftId: shift.id, kind: "SHIFT_LATE" } },
  });
  if (!cand) {
    if (existing && existing.status === "CANDIDATE") await prisma.kpiMark.delete({ where: { id: existing.id } });
    return;
  }
  if (!existing) {
    await prisma.kpiMark.create({
      data: {
        driverId: shift.driverId,
        shiftId: shift.id,
        kind: "SHIFT_LATE",
        status: "CANDIDATE",
        period: cand.period,
        occurredAt: cand.occurredAt,
        note: cand.note,
      },
    });
  } else if (existing.status === "CANDIDATE") {
    await prisma.kpiMark.update({
      where: { id: existing.id },
      data: { period: cand.period, occurredAt: cand.occurredAt, note: cand.note },
    });
  }
}

/**
 * Применить корректировку времени открытия (№3): обновить openedAt на актуальное (исправленное),
 * сохранить исходное и аудит правки, пересчитать SHIFT_LATE. Время приходит как ЧЧ:ММ (локальное МСК)
 * и привязывается к дате смены → корректный UTC-момент (иначе штраф/время «уедут» на 3 часа).
 * Причина обязательна. Запрещено в закрытом месяце. Время — любое (решение Артёма: раньше/позже факта).
 */
async function applyOpenAdjustment(
  shift: ShiftRow,
  timeHHMM: string,
  reason: string,
  actor: Actor,
): Promise<ShiftRow> {
  const note = (reason ?? "").trim();
  if (!note) throw Errors.validation("Укажите причину правки времени открытия");
  const minutes = parseHHMM(timeHHMM);
  if (minutes === null) throw Errors.validation("Некорректное время — нужен формат ЧЧ:ММ");
  const dateKey = shift.date.toISOString().slice(0, 10);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  // МСК = UTC+3 (как весь модуль KPI): локальное ЧЧ:ММ дня смены → корректный UTC-момент.
  const newOpenedAt = new Date(`${dateKey}T${hh}:${mm}:00.000+03:00`);
  const period = periodOf(newOpenedAt);
  if (await isPeriodClosed(period)) throw Errors.periodClosed();
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      openedAt: newOpenedAt,
      openedAtReported: shift.openedAtReported ?? shift.openedAt, // снимок исходного при первой правке
      openedAtAdjustedById: actor.id,
      openedAtAdjustedAt: new Date(),
      openedAtAdjustNote: note,
    },
    include: { driver: { select: { name: true } } },
  });
  await syncShiftLate(updated);
  return updated;
}

/**
 * Подтвердить открытие смены (диспетчер/админ): REQUESTED → OPEN. Можно сразу скорректировать время
 * открытия (adjust) — на случай «не было связи / сел телефон» (№3). При правке пересчитываем SHIFT_LATE.
 */
export async function confirmShift(
  shiftId: string,
  actor: Actor,
  adjust?: { timeHHMM: string; reason: string },
): Promise<ShiftView> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw Errors.notFound();
  if (shift.status !== "REQUESTED") throw Errors.validation("Смена уже подтверждена или закрыта");
  const opened = await prisma.shift.update({
    where: { id: shiftId },
    data: { status: "OPEN", confirmedById: actor.id, confirmedAt: new Date() },
    include: { driver: { select: { name: true } } },
  });
  if (adjust && (adjust.timeHHMM ?? "").trim()) {
    return toView(await applyOpenAdjustment(opened, adjust.timeHHMM, adjust.reason, actor));
  }
  return toView(opened);
}

/**
 * Правка времени открытия задним числом (диспетчер/админ, №3): для уже подтверждённой/закрытой смены,
 * пока месяц не закрыт. Сохраняет исходное время и аудит, пересчитывает SHIFT_LATE.
 */
export async function adjustShiftOpenedAt(
  shiftId: string,
  input: { timeHHMM: string; reason: string },
  actor: Actor,
): Promise<ShiftView> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw Errors.notFound();
  return toView(await applyOpenAdjustment(shift, input.timeHHMM, input.reason, actor));
}

/**
 * Отработано за день по задачам (мин) для каждого водителя: сумма «В работе → Завершено» по DONE
 * задачам дня + текущая активная (старт → сейчас). Для полосы рабочего времени на «Сегодня» (№5).
 */
async function workedMinutesByDriver(driverIds: string[], date: Date): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (driverIds.length === 0) return result;
  const dateKey = date.toISOString().slice(0, 10);
  const dayStart = new Date(`${dateKey}T00:00:00.000+03:00`); // начало дня в МСК
  const dayEnd = new Date(`${dateKey}T23:59:59.999+03:00`);
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { in: driverIds },
      OR: [{ status: "DONE", completedAt: { gte: dayStart, lte: dayEnd } }, { status: "IN_PROGRESS" }],
    },
    select: {
      assigneeId: true,
      status: true,
      completedAt: true,
      events: { where: { toStatus: "IN_PROGRESS" }, orderBy: { at: "asc" }, take: 1, select: { at: true } },
    },
  });
  const acc = new Map<string, number>();
  for (const t of tasks) {
    if (!t.assigneeId) continue;
    const startedAt = t.events[0]?.at;
    if (!startedAt) continue;
    const end = t.status === "DONE" ? t.completedAt : now;
    if (!end) continue;
    const ms = end.getTime() - startedAt.getTime();
    if (ms > 0) acc.set(t.assigneeId, (acc.get(t.assigneeId) ?? 0) + ms);
  }
  for (const [k, ms] of acc) result.set(k, Math.round(ms / 60000));
  return result;
}

/** Смены за день для доски диспетчера (все статусы, с именем водителя, отработано). Только диспетчер/админ. */
export async function listShiftsForDate(today: string): Promise<ShiftView[]> {
  const date = parseDate(today);
  const shifts = await prisma.shift.findMany({
    where: { date },
    include: { driver: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { openedAt: "asc" }],
  });
  const worked = await workedMinutesByDriver(
    shifts.map((s) => s.driverId),
    date,
  );
  return shifts.map((s) => ({ ...toView(s), workedMinutes: worked.get(s.driverId) ?? 0 }));
}
