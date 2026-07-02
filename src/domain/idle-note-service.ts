// Пометки диспетчера о простое водителя (решение Артёма 02.07): аналитика занятости + возможность
// одним действием создать ручной штраф KPI. Водителю пометки НЕ видны ни в одном ответе — все ручки
// за requireDispatcher (route), note Милены в note штрафа НЕ копируется (его водитель видит в
// «Мой расчёт»). Реестр, не журнал: пометку можно удалить, пока из неё не создан штраф.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { addManualMark, type Actor } from "./kpi-service";
import { utcDateKey } from "./kpi";
import type { IdleNoteView } from "@/lib/idle-note-dto";

export type { IdleNoteView } from "@/lib/idle-note-dto";

const MAX_IDLE_MINUTES = 720; // 12 часов — дольше смены не бывает

type NoteRow = {
  id: string;
  driverId: string;
  date: Date;
  minutes: number;
  note: string | null;
  kpiMarkId: string | null;
  createdAt: Date;
  driver: { name: string };
};

const noteInclude = { driver: { select: { name: true } } } as const;

function toView(n: NoteRow): IdleNoteView {
  return {
    id: n.id,
    driverId: n.driverId,
    driverName: n.driver.name,
    date: utcDateKey(n.date),
    minutes: n.minutes,
    note: n.note,
    kpiMarkId: n.kpiMarkId,
    createdAt: n.createdAt.toISOString(),
  };
}

function parseDay(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Errors.validation("Дата должна быть в формате YYYY-MM-DD");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw Errors.validation("Некорректная дата");
  return d;
}

/** Создать пометку о простое. Только по активному водителю (role=DRIVER). */
export async function createIdleNote(
  input: { driverId: string; date: string; minutes: number; note?: string | null },
  actor: Actor,
): Promise<IdleNoteView> {
  const driver = await prisma.user.findUnique({
    where: { id: input.driverId },
    select: { id: true, role: true, isActive: true },
  });
  if (!driver || driver.role !== "DRIVER" || !driver.isActive) throw Errors.validation("Неизвестный водитель");
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > MAX_IDLE_MINUTES) {
    throw Errors.validation(`Минуты простоя — целое от 1 до ${MAX_IDLE_MINUTES}`);
  }
  const created = await prisma.driverIdleNote.create({
    data: {
      driverId: input.driverId,
      date: parseDay(input.date),
      minutes: input.minutes,
      note: input.note?.trim() || null,
      createdById: actor.id,
    },
    include: noteInclude,
  });
  return toView(created);
}

/** Пометки за диапазон дат (включительно) — для доски (день) и Сводки (окно периода). */
export async function listIdleNotes(range: { from: string; to: string }): Promise<IdleNoteView[]> {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  const rows = await prisma.driverIdleNote.findMany({
    where: { date: { gte: from, lte: to } },
    include: noteInclude,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

/** Удалить пометку. Оштрафованную (kpiMarkId != null) удалять нельзя — сначала разберитесь со штрафом. */
export async function deleteIdleNote(id: string): Promise<void> {
  const note = await prisma.driverIdleNote.findUnique({ where: { id }, select: { kpiMarkId: true } });
  if (!note) throw Errors.notFound();
  if (note.kpiMarkId) throw Errors.validation("По пометке уже создан штраф — удалить нельзя");
  await prisma.driverIdleNote.delete({ where: { id } });
}

/**
 * Создать из пометки ручной штраф KPI (MANUAL, сумму вводит Милена). Повторно — нельзя (kpiMarkId
 * уникален). Переиспользует addManualMark: тот сам проверит активный денежный профиль и закрытость
 * месяца. Note штрафа — автотекст «Простой ДД.ММ, N мин» БЕЗ комментария Милены (водитель видит
 * note MANUAL в «Мой расчёт», а пометка должна остаться скрытой).
 */
export async function fineFromIdleNote(
  id: string,
  input: { amount: number },
  actor: Actor,
): Promise<IdleNoteView> {
  const note = await prisma.driverIdleNote.findUnique({ where: { id }, include: noteInclude });
  if (!note) throw Errors.notFound();
  if (note.kpiMarkId) throw Errors.validation("По пометке уже создан штраф");
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw Errors.validation("Сумма штрафа — целое число больше нуля");
  }
  const dateKey = utcDateKey(note.date);
  const period = dateKey.slice(0, 7);
  const label = `Простой ${dateKey.slice(8)}.${dateKey.slice(5, 7)}, ${note.minutes} мин`;
  const mark = await addManualMark(
    { driverId: note.driverId, amount: -Math.abs(input.amount), note: label, period },
    actor,
  );
  const updated = await prisma.driverIdleNote.update({
    where: { id },
    data: { kpiMarkId: mark.id },
    include: noteInclude,
  });
  return toView(updated);
}
