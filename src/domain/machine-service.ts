// Доменный сервис картотеки станков (ARCHITECTURE §4г, PRD §16). Вся логика модуля — здесь,
// route handlers остаются тонкими.
//
// Права: КАЖДАЯ экспортируемая функция начинается с assertMachineAccess(actor) — модуль защищён
// только ролью (изоляции «по владельцу» у общей картотеки нет by design, §6). Личность — из сессии.
//
// Журнал (MachineEvent) — только на запись, как TaskEvent: правки не переписывают историю, а
// добавляют событие с «было→стало». Optimistic-lock сознательно не делаем (пользователей три).
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { assertMachineAccess } from "./machine-access";
import {
  isArchivedStatus,
  isStatusAllowedForCategory,
  isOurCategory,
  reasonRequiredFor,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
} from "./machine-status";
import { machineFlags, summarize, type FlaggableMachine } from "./machine-flags";
import { machineMatches, parseQuery } from "@/lib/machine-search";
import { utcDateKey } from "./kpi";
import type { MachineCategory, MachineStatus, Role } from "@/generated/prisma/enums";
import type {
  MachineChange,
  MachineDetail,
  MachineListItem,
  MachineListResult,
} from "@/lib/machine-dto";

export type Actor = { id: string; role: Role };

const MAX_TEXT = 2000; // потолок на длинные текстовые поля (дефектовка/заметки)
const MAX_SHORT = 200; // потолок на короткие поля (модель, место, контакт…)
const CHANGE_VALUE_MAX = 120; // сколько символа значения храним в «было→стало» (журнал не архив текстов)
const ARCHIVE_PAGE = 30;

// ───────────────────────────────── вход ─────────────────────────────────

export type MachineFields = {
  ourNumber: number | null;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  serialNumber: string | null;
  orgName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  invoice1C: string | null;
  responsibleId: string | null;
  deliveredBy: string | null;
  arrivedAt: string | null; // YYYY-MM-DD
  isUrgent: boolean;
  defectNotes: string | null;
  location: string | null;
  notes: string | null;
};

/** Создание: обязательны ТОЛЬКО категория и модель (PRD §16.4) — инвентаризацию нельзя блокировать. */
export type CreateMachineInput = Partial<MachineFields> & { category: MachineCategory };
export type EditMachineInput = Partial<MachineFields>;

// ───────────────────────────────── выборки ─────────────────────────────────

const listSelect = {
  id: true,
  number: true,
  ourNumber: true,
  category: true,
  status: true,
  model: true,
  configuration: true,
  metalThickness: true,
  serialNumber: true,
  orgName: true,
  contactName: true,
  contactPhone: true,
  invoice1C: true,
  location: true,
  deliveredBy: true,
  defectNotes: true,
  notes: true,
  isUrgent: true,
  arrivedAt: true,
  diagnosedAt: true,
  lastVerifiedAt: true,
  responsibleId: true,
  responsible: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
  attachments: { select: { id: true }, orderBy: { createdAt: "asc" } },
} as const;

// Лёгкая выборка для счётчиков сводки: только поля, от которых зависят индикаторы.
const flagSelect = {
  category: true,
  status: true,
  invoice1C: true,
  isUrgent: true,
  arrivedAt: true,
  diagnosedAt: true,
  lastVerifiedAt: true,
  createdAt: true,
} as const;

type ListRow = {
  id: string;
  number: number;
  ourNumber: number | null;
  category: MachineCategory;
  status: MachineStatus;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  serialNumber: string | null;
  orgName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  invoice1C: string | null;
  location: string | null;
  deliveredBy: string | null;
  defectNotes: string | null;
  notes: string | null;
  isUrgent: boolean;
  arrivedAt: Date | null;
  diagnosedAt: Date | null;
  lastVerifiedAt: Date | null;
  responsibleId: string | null;
  responsible: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  attachments: { id: string }[];
};

function toListItem(m: ListRow): MachineListItem {
  return {
    id: m.id,
    number: m.number,
    ourNumber: m.ourNumber,
    category: m.category,
    status: m.status,
    model: m.model,
    configuration: m.configuration,
    metalThickness: m.metalThickness,
    serialNumber: m.serialNumber,
    orgName: m.orgName,
    contactName: m.contactName,
    contactPhone: m.contactPhone,
    invoice1C: m.invoice1C,
    location: m.location,
    deliveredBy: m.deliveredBy,
    defectNotes: m.defectNotes,
    notes: m.notes,
    isUrgent: m.isUrgent,
    arrivedAt: m.arrivedAt ? utcDateKey(m.arrivedAt) : null,
    diagnosedAt: m.diagnosedAt?.toISOString() ?? null,
    lastVerifiedAt: m.lastVerifiedAt?.toISOString() ?? null,
    responsibleId: m.responsibleId,
    responsibleName: m.responsible?.name ?? null,
    photoId: m.attachments[0]?.id ?? null,
    photoCount: m.attachments.length,
    updatedAt: m.updatedAt.toISOString(),
  };
}

// ───────────────────────────────── валидация ─────────────────────────────────

function trimTo(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function parseDay(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Errors.validation("Дата должна быть в формате YYYY-MM-DD");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw Errors.validation("Некорректная дата");
  return d;
}

/** Ответственный менеджер — существующий активный сотрудник (не водитель: станки ведёт офис). */
async function assertResponsible(responsibleId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: responsibleId },
    select: { role: true, isActive: true },
  });
  if (!user || !user.isActive || user.role === "DRIVER") {
    throw Errors.validation("Ответственным можно назначить только сотрудника офиса");
  }
}

type FieldPatch = Record<string, unknown>;

/**
 * Разбор полей карточки в данные Prisma. Пустая строка = «очистить поле» (null): менеджер стёр
 * значение — так и записываем, иначе поле нельзя было бы освободить.
 */
async function buildFields(input: EditMachineInput, category: MachineCategory): Promise<FieldPatch> {
  const patch: FieldPatch = {};

  if ("model" in input) {
    const model = trimTo(input.model, MAX_SHORT);
    if (!model) throw Errors.validation("Укажите модель станка");
    patch.model = model;
  }
  for (const key of ["configuration", "metalThickness", "serialNumber", "orgName", "contactName", "contactPhone", "invoice1C", "deliveredBy", "location"] as const) {
    if (key in input) patch[key] = trimTo(input[key], MAX_SHORT);
  }
  for (const key of ["defectNotes", "notes"] as const) {
    if (key in input) patch[key] = trimTo(input[key], MAX_TEXT);
  }
  if ("isUrgent" in input) patch.isUrgent = input.isUrgent === true;

  if ("arrivedAt" in input) {
    const raw = input.arrivedAt;
    patch.arrivedAt = typeof raw === "string" && raw.trim() ? parseDay(raw.trim()) : null;
  }

  if ("ourNumber" in input) {
    const raw = input.ourNumber;
    if (raw === null || raw === undefined) {
      patch.ourNumber = null;
    } else {
      if (!Number.isInteger(raw) || raw < 1 || raw > 100_000) {
        throw Errors.validation("Наш номер — целое число больше нуля");
      }
      // Клиентский станок нашим номером не маркируем: «77-N» — маркировка нашего парка (PRD §16.2).
      if (!isOurCategory(category)) {
        throw Errors.validation("Номер «77-N» ставится только нашим станкам");
      }
      patch.ourNumber = raw;
    }
  }

  if ("responsibleId" in input) {
    const raw = input.responsibleId;
    if (raw === null || raw === undefined || raw === "") {
      patch.responsibleId = null;
    } else {
      await assertResponsible(raw);
      patch.responsibleId = raw;
    }
  }

  return patch;
}

/** Дубль «77-N» — человеческая ошибка ввода при инвентаризации, а не 500 (решение Артёма). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

// ───────────────────────────────── журнал ─────────────────────────────────

// Поля, попадающие в «было→стало». Ключевые для расследования («кто передвинул станок») идут
// первыми; длинные тексты тоже пишем, но обрезанными — журнал не хранилище текстов.
const TRACKED: { field: keyof MachineFields | "category"; label: string }[] = [
  { field: "category", label: "Категория" },
  { field: "location", label: "Место на площадке" },
  { field: "responsibleId", label: "Ответственный" },
  { field: "ourNumber", label: "Наш номер" },
  { field: "model", label: "Модель" },
  { field: "configuration", label: "Комплектация" },
  { field: "metalThickness", label: "Толщина металла" },
  { field: "serialNumber", label: "Серийный номер" },
  { field: "orgName", label: "Заказчик" },
  { field: "contactName", label: "Контакт" },
  { field: "contactPhone", label: "Телефон" },
  { field: "invoice1C", label: "Заказ 1С" },
  { field: "deliveredBy", label: "Кто привёз" },
  { field: "arrivedAt", label: "Дата поступления" },
  { field: "isUrgent", label: "Срочно" },
  { field: "defectNotes", label: "Дефектовка" },
  { field: "notes", label: "Заметки" },
];

/** Значение поля в человекочитаемом виде для журнала. */
function displayValue(field: string, value: unknown, names: Map<string, string>): string | null {
  if (value === null || value === undefined) return null;
  if (field === "category") return MACHINE_CATEGORY_LABEL[value as MachineCategory];
  if (field === "responsibleId") return names.get(String(value)) ?? "—";
  if (field === "ourNumber") return `77-${String(value)}`;
  if (field === "isUrgent") return value === true ? "да" : "нет";
  if (value instanceof Date) {
    const [y, m, d] = utcDateKey(value).split("-");
    return `${d}.${m}.${y}`;
  }
  const s = String(value);
  if (!s.trim()) return null;
  return s.length > CHANGE_VALUE_MAX ? `${s.slice(0, CHANGE_VALUE_MAX)}…` : s;
}

/** Диф правки: только реально изменившиеся поля. Пустой диф → события не пишем и БД не трогаем. */
function buildChanges(
  before: Record<string, unknown>,
  patch: FieldPatch,
  names: Map<string, string>,
): MachineChange[] {
  const out: MachineChange[] = [];
  for (const { field, label } of TRACKED) {
    if (!(field in patch)) continue;
    const from = before[field] ?? null;
    const to = patch[field] ?? null;
    const fromKey = from instanceof Date ? from.getTime() : from;
    const toKey = to instanceof Date ? to.getTime() : to;
    if (fromKey === toKey) continue;
    out.push({
      field: String(field),
      label,
      from: displayValue(String(field), from, names),
      to: displayValue(String(field), to, names),
    });
  }
  return out;
}

/** Имена пользователей, упомянутых в дифе (ответственный «было» и «стало»). */
async function namesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

// ───────────────────────────────── операции ─────────────────────────────────

/** Завести станок. Учётный номер выдаёт БД (sequence); карточка не ждёт фото. */
export async function createMachine(input: CreateMachineInput, actor: Actor): Promise<MachineDetail> {
  assertMachineAccess(actor);
  if (!input.category || !MACHINE_CATEGORY_LABEL[input.category]) {
    throw Errors.validation("Выберите категорию станка");
  }
  const model = trimTo(input.model, MAX_SHORT);
  if (!model) throw Errors.validation("Укажите модель станка");

  const patch = await buildFields({ ...input, model }, input.category);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const machine = await tx.machine.create({
        data: { ...patch, model, category: input.category, createdById: actor.id },
        select: { id: true },
      });
      await tx.machineEvent.create({
        data: { machineId: machine.id, actorId: actor.id, kind: "created", toStatus: "ACCEPTED" },
      });
      return machine;
    });
    return getMachine(created.id, actor);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw Errors.validation(`Номер 77-${input.ourNumber} уже занят другим станком`);
    }
    throw e;
  }
}

export type ListParams = {
  scope?: "active" | "archive";
  category?: MachineCategory;
  status?: MachineStatus;
  /** Готовый фильтр-плитка из сводки. */
  flag?: "noInvoice1C" | "urgent" | "awaitingDiagnosis" | "staleVerification";
  q?: string;
  take?: number;
  skip?: number;
};

/**
 * Список + счётчики сводки. Активные (десятки) отдаются целиком — фильтрует и ищет клиент мгновенно.
 * Архив ищется и режется на странице сервером ТЕМ ЖЕ движком поиска, что и клиент: SQL-ILIKE не
 * умеет ни раскладку, ни «8≈+7», и два разных поиска неизбежно разошлись бы в ответах. Осознанная
 * граница: при 5–15 станках в неделю архив растёт на ~700 записей в год — выборка лёгкая
 * (select без текстов-простыней), к тому моменту, когда это станет дорого, модуль всё равно
 * переработают (этапы 2–3).
 */
export async function listMachines(params: ListParams, actor: Actor): Promise<MachineListResult> {
  assertMachineAccess(actor);
  const scope = params.scope === "archive" ? "archive" : "active";
  const archivedStatuses: MachineStatus[] = ["RELEASED", "SOLD", "VOIDED"];

  const where = {
    ...(scope === "archive"
      ? { status: { in: archivedStatuses } }
      : { status: { notIn: archivedStatuses } }),
    ...(params.category ? { category: params.category } : {}),
    ...(params.status ? { status: params.status } : {}),
  };

  const [rows, flagRows, locationRows] = await Promise.all([
    prisma.machine.findMany({
      where,
      select: listSelect,
      orderBy: [{ isUrgent: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.machine.findMany({ select: flagSelect }),
    prisma.machine.findMany({
      where: { location: { not: null } },
      select: { location: true },
      distinct: ["location"],
      orderBy: { location: "asc" },
    }),
  ]);

  const summary = summarize(flagRows as FlaggableMachine[], new Date());

  let items = (rows as ListRow[]).map(toListItem);

  // Фильтр по плитке сводки — ТОЙ ЖЕ функцией, что считает счётчики (одна правда, не копия условий).
  if (params.flag) {
    const now = new Date();
    const flag = params.flag;
    const byId = new Map((rows as ListRow[]).map((r) => [r.id, r]));
    items = items.filter((item) => {
      const row = byId.get(item.id);
      return row ? machineFlags(row, now)[flag] : false;
    });
  }

  const q = parseQuery(params.q ?? "");
  if (q.active) items = items.filter((m) => machineMatches(m, q));

  const total = items.length;
  const take = Math.min(Math.max(params.take ?? (scope === "archive" ? ARCHIVE_PAGE : total), 1), 500);
  const skip = Math.max(params.skip ?? 0, 0);
  const page = scope === "archive" ? items.slice(skip, skip + take) : items;

  return {
    machines: page,
    summary,
    locations: locationRows
      .map((r) => r.location)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
    hasMore: scope === "archive" ? skip + page.length < total : false,
    total,
  };
}

/** Карточка станка: поля + фото + журнал. */
export async function getMachine(id: string, actor: Actor): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const m = await prisma.machine.findUnique({
    where: { id },
    select: {
      ...listSelect,
      voidReason: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      attachments: {
        select: { id: true, mimeType: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        select: {
          id: true,
          kind: true,
          fromStatus: true,
          toStatus: true,
          comment: true,
          changes: true,
          at: true,
          actor: { select: { name: true } },
        },
        orderBy: { at: "desc" },
      },
    },
  });
  if (!m) throw Errors.notFound();

  const base = toListItem({
    ...m,
    attachments: m.attachments.map((a) => ({ id: a.id })),
  } as ListRow);

  return {
    ...base,
    voidReason: m.voidReason,
    createdAt: m.createdAt.toISOString(),
    createdByName: m.createdBy?.name ?? null,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      createdAt: a.createdAt.toISOString(),
    })),
    events: m.events.map((e) => ({
      id: e.id,
      kind: e.kind,
      actorName: e.actor?.name ?? "—",
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      comment: e.comment,
      changes: Array.isArray(e.changes) ? (e.changes as unknown as MachineChange[]) : [],
      at: e.at.toISOString(),
    })),
  };
}

/** Правка полей карточки. Пишет в журнал «было→стало»; правка без изменений событие не создаёт. */
export async function editMachine(
  id: string,
  input: EditMachineInput,
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({ where: { id } });
  if (!before) throw Errors.notFound();

  const patch = await buildFields(input, before.category);
  const names = await namesFor([before.responsibleId, patch.responsibleId as string | null]);
  const changes = buildChanges(before as unknown as Record<string, unknown>, patch, names);
  if (changes.length === 0) return getMachine(id, actor);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.machine.update({ where: { id }, data: patch });
      await tx.machineEvent.create({
        data: { machineId: id, actorId: actor.id, kind: "edit", changes },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw Errors.validation("Такой номер «77-N» уже занят другим станком");
    throw e;
  }
  return getMachine(id, actor);
}

/**
 * Смена состояния. Матрицы переходов нет (PRD §16.3) — проверяется совместимость с категорией
 * и обязательность причины для аннулирования. Возврат из архива разрешён: та же карточка живёт
 * дальше, история копится.
 */
export async function changeStatus(
  id: string,
  input: { status: MachineStatus; reason?: string | null },
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, status: true, category: true },
  });
  if (!before) throw Errors.notFound();
  if (!MACHINE_STATUS_LABEL[input.status]) throw Errors.validation("Неизвестное состояние");
  if (before.status === input.status) return getMachine(id, actor);

  if (!isStatusAllowedForCategory(before.category, input.status)) {
    throw Errors.machineStatusCategory(
      `«${MACHINE_STATUS_LABEL[input.status]}» не подходит категории «${MACHINE_CATEGORY_LABEL[before.category]}»`,
    );
  }
  const reason = trimTo(input.reason, MAX_SHORT);
  if (reasonRequiredFor(input.status) && !reason) {
    throw Errors.reasonRequired();
  }

  await prisma.$transaction(async (tx) => {
    await tx.machine.update({
      where: { id },
      data: {
        status: input.status,
        // Причина аннулирования живёт на карточке (её показываем в архиве); при выходе из VOIDED — снимаем.
        voidReason: input.status === "VOIDED" ? reason : null,
      },
    });
    await tx.machineEvent.create({
      data: {
        machineId: id,
        actorId: actor.id,
        kind: "status_change",
        fromStatus: before.status,
        toStatus: input.status,
        comment: reason,
      },
    });
  });
  return getMachine(id, actor);
}

/** Смена категории. Текущее состояние обязано остаться совместимым (нельзя «в аренде» у продажного). */
export async function changeCategory(
  id: string,
  input: { category: MachineCategory },
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, status: true, category: true, ourNumber: true },
  });
  if (!before) throw Errors.notFound();
  if (!MACHINE_CATEGORY_LABEL[input.category]) throw Errors.validation("Неизвестная категория");
  if (before.category === input.category) return getMachine(id, actor);

  if (!isStatusAllowedForCategory(input.category, before.status)) {
    throw Errors.machineStatusCategory(
      `Сначала смените состояние: «${MACHINE_STATUS_LABEL[before.status]}» не бывает у категории «${MACHINE_CATEGORY_LABEL[input.category]}»`,
    );
  }
  // Номер «77-N» есть только у наших станков: при переводе в клиентские он снимается.
  const dropOurNumber = !isOurCategory(input.category) && before.ourNumber !== null;

  const names = new Map<string, string>();
  const changes = buildChanges(
    { category: before.category, ourNumber: before.ourNumber },
    { category: input.category, ...(dropOurNumber ? { ourNumber: null } : {}) },
    names,
  );

  await prisma.$transaction(async (tx) => {
    await tx.machine.update({
      where: { id },
      data: { category: input.category, ...(dropOurNumber ? { ourNumber: null } : {}) },
    });
    await tx.machineEvent.create({
      data: { machineId: id, actorId: actor.id, kind: "edit", changes },
    });
  });
  return getMachine(id, actor);
}

/** Отметка «Диагностика проведена» / «Подтверждён на месте» — снимает соответствующий индикатор. */
export async function markChecked(
  id: string,
  op: "diagnosed" | "verified",
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const exists = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw Errors.notFound();

  const now = new Date();
  const label = op === "diagnosed" ? "Диагностика проведена" : "Подтверждён на месте";
  await prisma.$transaction(async (tx) => {
    await tx.machine.update({
      where: { id },
      data: op === "diagnosed" ? { diagnosedAt: now } : { lastVerifiedAt: now },
    });
    await tx.machineEvent.create({
      data: { machineId: id, actorId: actor.id, kind: "comment", comment: label },
    });
  });
  return getMachine(id, actor);
}

/** Комментарий в журнал станка. */
export async function addComment(id: string, text: string, actor: Actor): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const comment = trimTo(text, MAX_TEXT);
  if (!comment) throw Errors.validation("Пустой комментарий");
  const exists = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw Errors.notFound();

  await prisma.machineEvent.create({
    data: { machineId: id, actorId: actor.id, kind: "comment", comment },
  });
  return getMachine(id, actor);
}

/** Подсказка следующего свободного «77-N» для наших станков. */
export async function nextOurNumber(actor: Actor): Promise<number> {
  assertMachineAccess(actor);
  const max = await prisma.machine.aggregate({ _max: { ourNumber: true } });
  return (max._max.ourNumber ?? 0) + 1;
}

/** Сотрудники офиса, которых можно назначить ответственными (Милена/Максим/Михаил/Артём). */
export async function listResponsibles(actor: Actor): Promise<{ id: string; name: string }[]> {
  assertMachineAccess(actor);
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "DISPATCHER", "SERVICE_MANAGER"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export { isArchivedStatus };
