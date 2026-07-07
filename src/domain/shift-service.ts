// Доменный сервис смен водителя (этап C, переработка механики). Открытие/подтверждение/закрытие.
// Изоляция (CLAUDE.md правило 1, ARCHITECTURE §6): для водителя driverId берётся ТОЛЬКО из сессии
// (аргумент), никогда из тела запроса. Подтверждение, список смен и правка времени — только диспетчер/
// админ (гейт в route handler). Учёт отработанного/простоя по сменам — этап D, из openedAt/closedAt.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { detectShiftLate, periodOf, parseHHMM, dateKeyInTz, KPI_TZ } from "./kpi";
import { resolveOccurredAt } from "./occurred-at";
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
  openedOffline: boolean; // открыта офлайн (O7): openedAt — время телефона, Милене видна пометка
  confirmedAt: string | null;
  closedAt: string | null;
  // Закрытие смены Д/А (№2) и правка времени закрытия (№3, 03.07). closedById — кто закрыл за водителя
  // (null — сам водитель). closedAtReported/AdjustNote — исходное время и факт правки (показ «время
  // скорректировано»).
  closedById: string | null;
  closedAtReported: string | null;
  closedAtAdjustedAt: string | null;
  closedAtAdjustNote: string | null;
  // Отработано за день по задачам (В работе → Завершено + текущая активная), мин — для полосы на
  // «Сегодня» (№5). Заполняется только в listShiftsForDate; в одиночных ответах не нужно.
  workedMinutes?: number;
  // Ручная коррекция авто-простоя (07.07): фактический простой смены, мин (null = авто-расчёт). Доска
  // и Сводка используют его вместо авто-расчёта, если задан. note — причина (для показа «скорректировано»).
  idleMinutesOverride: number | null;
  idleOverrideNote: string | null;
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
  openedOffline: boolean;
  confirmedAt: Date | null;
  closedAt: Date | null;
  closedById: string | null;
  closedAtReported: Date | null;
  closedAtAdjustedAt: Date | null;
  closedAtAdjustNote: string | null;
  idleMinutesOverride: number | null;
  idleOverrideNote: string | null;
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
    openedOffline: s.openedOffline,
    confirmedAt: s.confirmedAt ? s.confirmedAt.toISOString() : null,
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    closedById: s.closedById,
    closedAtReported: s.closedAtReported ? s.closedAtReported.toISOString() : null,
    closedAtAdjustedAt: s.closedAtAdjustedAt ? s.closedAtAdjustedAt.toISOString() : null,
    closedAtAdjustNote: s.closedAtAdjustNote,
    idleMinutesOverride: s.idleMinutesOverride,
    idleOverrideNote: s.idleOverrideNote,
  };
}

/**
 * Убрать из ответа водителю диспетчерские поля коррекции простоя (изоляция, как пометки Милены):
 * простой смены водителю на экранах не показывается вообще, а причина коррекции — диспетчерский текст,
 * не для глаз водителя. Применять на границе всех водительских ответов (/api/my/shift).
 */
export function hideDispatcherIdle(view: ShiftView | null): ShiftView | null {
  if (!view) return null;
  return { ...view, idleMinutesOverride: null, idleOverrideNote: null };
}

/** Смена водителя на день (или null). driverId — ТОЛЬКО из сессии. */
export async function getMyShift(driverId: string, today: string): Promise<ShiftView | null> {
  const date = parseDate(today);
  const shift = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  return shift ? toView(shift) : null;
}

/** День смены вычисляется на СЕРВЕРЕ (preflight-аудит В2): клиентскому `today` не доверяем — иначе
 *  подделанная/сбитая зона телефона пишет смену не на тот день и обходит штраф «поздно открыл»
 *  (детектор SHIFT_LATE и учёт простоя выбирают смены по date). С O7 смена работает и офлайн: момент
 *  действия берём из X-Occurred-At, но только через resolveOccurredAt (clamp [now−36ч; now+2мин],
 *  мусор/вне окна → время сервера) — день считается от ДОСТОВЕРНОГО момента в МСК. */
function shiftDateOf(at: Date): Date {
  return parseDate(dateKeyInTz(at, KPI_TZ));
}

// Порог детекта «открыта офлайн» (O7): онлайн-нажатие доходит за доли секунды, досылка из офлайн-очереди —
// через минуты/часы. Разница now−occurredAt больше порога ⇒ время открытия зафиксировал телефон, не сервер.
const OFFLINE_LAG_MS = 60_000;

/**
 * Открыть смену (водитель). Фиксирует фактическое начало рабочего дня = момент нажатия (occurredAtRaw
 * из офлайн-очереди; онлайн он равен «сейчас»). Повторное открытие в тот же день — идемпотентно
 * (возвращаем текущую смену, не пересоздаём и не сдвигаем время) — досылка после вмешательства
 * диспетчера не даёт конфликта.
 */
export async function openShift(driverId: string, occurredAtRaw?: string | null): Promise<ShiftView> {
  const now = new Date();
  const at = resolveOccurredAt(occurredAtRaw, now);
  const date = shiftDateOf(at);
  const existing = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  if (existing) return toView(existing);
  const created = await prisma.shift.create({
    data: {
      driverId,
      date,
      status: "REQUESTED",
      openedAt: at,
      openedOffline: now.getTime() - at.getTime() > OFFLINE_LAG_MS,
    },
  });
  return toView(created);
}

/**
 * Закрыть смену (водитель). Допустимо из REQUESTED и OPEN. Повторное закрытие — идемпотентно.
 * Офлайн-досылка (O7): closedAt = момент нажатия; если на день нажатия смены нет (закрытие уехало за
 * полночь) — закрываем последнюю незакрытую смену водителя. Совсем нет смены → мягкая доменная ошибка
 * (в очереди станет «конфликтом» с человеческой причиной, а не тупиком).
 */
export async function closeShift(driverId: string, occurredAtRaw?: string | null): Promise<ShiftView> {
  const now = new Date();
  const at = resolveOccurredAt(occurredAtRaw, now);
  const date = shiftDateOf(at);
  const byDate = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  const shift =
    byDate ??
    (await prisma.shift.findFirst({
      where: { driverId, status: { in: ["REQUESTED", "OPEN"] } },
      orderBy: { date: "desc" },
    }));
  if (!shift) throw Errors.validation("Смена не найдена — сначала откройте смену");
  if (shift.status === "CLOSED") return toView(shift);
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { status: "CLOSED", closedAt: at },
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
 * Переоткрыть смену водителем (на случай случайного закрытия). driverId — ТОЛЬКО из сессии; день — от
 * достоверного момента нажатия (O7: работает и из офлайн-очереди). Если на день нажатия смены нет —
 * берём последнюю смену водителя (досылка уехала за полночь). Идемпотентно: не закрыта — как есть.
 */
export async function reopenShift(driverId: string, occurredAtRaw?: string | null): Promise<ShiftView> {
  const at = resolveOccurredAt(occurredAtRaw);
  const date = shiftDateOf(at);
  const byDate = await prisma.shift.findUnique({ where: { driverId_date: { driverId, date } } });
  const shift = byDate ?? (await prisma.shift.findFirst({ where: { driverId }, orderBy: { date: "desc" } }));
  if (!shift) throw Errors.validation("Смена не найдена — сначала откройте смену");
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
// Локальное ЧЧ:ММ дня смены → корректный UTC-момент. МСК = UTC+3 (как весь модуль KPI): иначе время
// открытия/закрытия «уедет» на 3 часа. Валидирует формат.
function shiftMomentFromHHMM(date: Date, timeHHMM: string): Date {
  const minutes = parseHHMM(timeHHMM);
  if (minutes === null) throw Errors.validation("Некорректное время — нужен формат ЧЧ:ММ");
  const dateKey = date.toISOString().slice(0, 10);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return new Date(`${dateKey}T${hh}:${mm}:00.000+03:00`);
}

async function applyOpenAdjustment(
  shift: ShiftRow,
  timeHHMM: string,
  reason: string,
  actor: Actor,
): Promise<ShiftRow> {
  const note = (reason ?? "").trim();
  if (!note) throw Errors.validation("Укажите причину правки времени открытия");
  const newOpenedAt = shiftMomentFromHHMM(shift.date, timeHHMM);
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
 * Закрыть смену водителя диспетчером/директором/админом (№2, 03.07). Гейт роли (Д/А) — в route handler;
 * работаем по shiftId, личность водителя берётся из самой смены (изоляция цела). closedById фиксирует,
 * кто закрыл. Идемпотентно: уже закрытая смена возвращается как есть. По умолчанию closedAt = «сейчас»;
 * можно задать время вручную (ЧЧ:ММ дня смены) с опциональной причиной — тогда пишем пометку в аудит
 * (reported не нужен: это первое закрытие, прежнего времени не было). Ручное время в закрытом месяце
 * запрещено (влияет на «простой» и деньги в Сводке).
 */
export async function closeShiftById(
  shiftId: string,
  actor: Actor,
  adjust?: { closedAtTime?: string | null; reason?: string | null },
): Promise<ShiftView> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { driver: { select: { name: true } } },
  });
  if (!shift) throw Errors.notFound();
  if (shift.status === "CLOSED") return toView(shift); // идемпотентно
  const timeHHMM = (adjust?.closedAtTime ?? "").trim();
  const reason = (adjust?.reason ?? "").trim();
  const closedAt = timeHHMM ? shiftMomentFromHHMM(shift.date, timeHHMM) : new Date();
  if (timeHHMM && (await isPeriodClosed(periodOf(closedAt)))) throw Errors.periodClosed();
  const auditManualTime =
    timeHHMM && reason
      ? { closedAtAdjustNote: reason, closedAtAdjustedById: actor.id, closedAtAdjustedAt: new Date() }
      : {};
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { status: "CLOSED", closedAt, closedById: actor.id, ...auditManualTime },
    include: { driver: { select: { name: true } } },
  });
  return toView(updated);
}

/**
 * Применить корректировку времени ЗАКРЫТИЯ (№3) — зеркало applyOpenAdjustment. Причина обязательна,
 * сохраняем снимок исходного closedAt и аудит, запрещаем в закрытом месяце. SHIFT_LATE не трогаем
 * (он про открытие); «простой» в Сводке считается на лету по closedAt−openedAt и отразит правку сам.
 */
async function applyCloseAdjustment(
  shift: ShiftRow,
  timeHHMM: string,
  reason: string,
  actor: Actor,
): Promise<ShiftRow> {
  const note = (reason ?? "").trim();
  if (!note) throw Errors.validation("Укажите причину правки времени закрытия");
  const newClosedAt = shiftMomentFromHHMM(shift.date, timeHHMM);
  if (await isPeriodClosed(periodOf(newClosedAt))) throw Errors.periodClosed();
  return prisma.shift.update({
    where: { id: shift.id },
    data: {
      closedAt: newClosedAt,
      closedAtReported: shift.closedAtReported ?? shift.closedAt, // снимок исходного при первой правке
      closedAtAdjustedById: actor.id,
      closedAtAdjustedAt: new Date(),
      closedAtAdjustNote: note,
    },
    include: { driver: { select: { name: true } } },
  });
}

/**
 * Правка времени закрытия задним числом (диспетчер/админ, №3): только для уже закрытой смены, пока
 * месяц не закрыт. Сохраняет исходное время и аудит.
 */
export async function adjustShiftClosedAt(
  shiftId: string,
  input: { timeHHMM: string; reason: string },
  actor: Actor,
): Promise<ShiftView> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw Errors.notFound();
  if (!shift.closedAt) throw Errors.validation("Смена ещё не закрыта — время закрытия править нельзя");
  return toView(await applyCloseAdjustment(shift, input.timeHHMM, input.reason, actor));
}

const MAX_IDLE_OVERRIDE_MINUTES = 720; // 12 часов — дольше смены не бывает (как в idle-note-service)

/**
 * Ручная коррекция авто-простоя смены (решение Артёма 07.07). Полоса «В работе / Простой» на доске и
 * в Сводке считается автоматически (простой = длина смены − время задач «В работе»). Если водитель
 * работал, но не взял задачу в работу (сел телефон), система засчитывает простой ошибочно — диспетчер/
 * админ задаёт ФАКТИЧЕСКИЙ простой смены (мин), перебивая авто-расчёт. `idleMinutes = null` — сброс к
 * авто-расчёту. Причина обязательна при установке значения; запрещено в закрытом месяце (простой влияет
 * на деньги в Сводке). Гейт роли (Д/А) — в route handler; работаем по shiftId, личность водителя берётся
 * из самой смены (изоляция цела). Аудит: кто/когда/причина.
 */
export async function adjustShiftIdle(
  shiftId: string,
  input: { idleMinutes: number | null; reason: string },
  actor: Actor,
): Promise<ShiftView> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { driver: { select: { name: true } } },
  });
  if (!shift) throw Errors.notFound();
  if (await isPeriodClosed(periodOf(shift.date))) throw Errors.periodClosed();

  if (input.idleMinutes === null) {
    // Сброс к авто-расчёту: снимаем override и его причину, фиксируем факт сброса в аудите.
    const updated = await prisma.shift.update({
      where: { id: shift.id },
      data: {
        idleMinutesOverride: null,
        idleOverrideNote: null,
        idleOverrideById: actor.id,
        idleOverrideAt: new Date(),
      },
      include: { driver: { select: { name: true } } },
    });
    return toView(updated);
  }

  const minutes = input.idleMinutes;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_IDLE_OVERRIDE_MINUTES) {
    throw Errors.validation(`Минуты простоя — целое от 0 до ${MAX_IDLE_OVERRIDE_MINUTES}`);
  }
  const reason = (input.reason ?? "").trim();
  if (!reason) throw Errors.validation("Укажите причину коррекции простоя");

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      idleMinutesOverride: minutes,
      idleOverrideNote: reason,
      idleOverrideById: actor.id,
      idleOverrideAt: new Date(),
    },
    include: { driver: { select: { name: true } } },
  });
  return toView(updated);
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
