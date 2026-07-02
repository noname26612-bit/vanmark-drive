// Доменный сервис задач: создание (с авто-номером), назначение, переходы по матрице,
// перенос, комментарии, чтения. Вся логика и проверки прав — здесь (ARCHITECTURE §3).
// Каждое изменение атомарно пишет событие в TaskEvent (CLAUDE.md правило 3 — журнал только на запись).
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PassStatus, PaymentType, Role, TaskStatus, WorksheetStatus } from "@/generated/prisma/enums";
import { checkTransition, isDispatcherRole } from "./task-status";
import { resolveAssignedDate } from "./assign-date";
import { canViewTask } from "./authz";
import { myTasksWhere, type MyTasksScope } from "./my-tasks";
import { overdueWhere, tomorrowPassWhere } from "./attention";
import { Errors } from "./errors";
import { resolveOccurredAt } from "./occurred-at";
import { notifyTaskAssignee } from "@/lib/push";
import { geocodeAddress } from "@/lib/geocode";
import { computeEstimate } from "./capacity-service";
import type { LatLng } from "./capacity";

export type Actor = { id: string; role: Role };

export type CreateTaskInput = {
  typeId: string;
  title: string;
  address: string;
  description?: string | null;
  equipment?: string | null;
  orgName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  addressLink?: string | null;
  invoiceNumber?: string | null;
  paymentType?: PaymentType;
  paymentAmount?: number | null;
  paymentNote?: string | null;
  scheduledDate?: string | null; // YYYY-MM-DD
  timeFrom?: string | null;
  timeTo?: string | null;
  timeNote?: string | null;
  passStatus?: PassStatus;
  priority?: boolean;
  assigneeId?: string | null;
  requiresAct?: boolean | null; // override требования акта (по умолчанию из типа); false = «акт не нужен»
  actWaivedNote?: string | null; // причина снятия требования акта на заявке
  // Ёмкость (Фаза 2, PRD §14): ручная оценка времени диспетчером. number → manual (не пересчитывать);
  // null → сброс к авто-расчёту. undefined (поле не передано) → оценку не трогаем (пересчёт по правкам).
  estimatedMinutes?: number | null;
};

export type ListFilters = {
  date?: string; // одиночная дата (доска «Сегодня»)
  includeUndated?: boolean; // добавить пул «Без даты»
  dateFrom?: string;
  dateTo?: string;
  undatedOnly?: boolean;
  assigneeId?: string | "none"; // "none" — не назначено
  status?: TaskStatus;
  typeId?: string;
  q?: string;
};

// Краткие связи для карточек/списков (используется и записями: createTask/assign/transition...).
const taskInclude = {
  type: true,
  assignee: { select: { id: true, name: true, login: true } },
} satisfies Prisma.TaskInclude;

// Списки-чтения дополнительно тянут число приложенных актов (DOCUMENT-вложений) — лёгкий
// фильтрованный _count, чтобы показать признак комплектности акта (этап 14, PRD §13). filePath
// не раскрывается. Записи используют taskInclude без счётчика (им признак не нужен).
const taskListInclude = {
  ...taskInclude,
  _count: { select: { attachments: { where: { kind: "DOCUMENT" } } } },
} satisfies Prisma.TaskInclude;

// Полная карточка с историей.
const taskDetailInclude = {
  type: true,
  assignee: { select: { id: true, name: true, login: true } },
  createdBy: { select: { id: true, name: true } },
  events: {
    orderBy: { at: "asc" },
    include: { actor: { select: { id: true, name: true } } },
  },
  attachments: {
    orderBy: { createdAt: "asc" },
    // filePath/sizeBytes НЕ отдаём клиенту — файл берётся только через GET /api/attachments/:id.
    select: {
      id: true,
      kind: true,
      mimeType: true,
      createdById: true,
      lat: true,
      lng: true,
      createdAt: true,
    },
  },
  workItems: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      catalogItemId: true,
      name: true,
      quantity: true,
      price: true,
      sortOrder: true,
      createdById: true,
      createdAt: true,
    },
  },
} satisfies Prisma.TaskInclude;

export type TaskListItem = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
export type TaskDetail = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

// Карточка с цено-подсказками к позициям ведомости (этап «справочник»). defaultPrice добавляется
// ТОЛЬКО для диспетчера/админа (водителю цены не видны, PRD §13). Для водителя поле отсутствует.
type WorkItemWithHint = TaskDetail["workItems"][number] & { defaultPrice?: number | null };
export type TaskDetailWire = Omit<TaskDetail, "workItems"> & { workItems: WorkItemWithHint[] };

// Элемент списка для клиента: payload с _count, развёрнутым в булев флаг hasSignedDoc (этап 14).
type TaskListPayload = Prisma.TaskGetPayload<{ include: typeof taskListInclude }>;
export type TaskListWire = Omit<TaskListPayload, "_count"> & { hasSignedDoc: boolean };

// Разворачивает фильтрованный _count в поле hasSignedDoc (и убирает служебный _count из ответа).
function withActFlag(t: TaskListPayload): TaskListWire {
  const { _count, ...rest } = t;
  return { ...rest, hasSignedDoc: _count.attachments > 0 };
}

function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// YYYY-MM-DD → Date в UTC-полночь (поле @db.Date хранит только дату; UTC исключает сдвиг на день).
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Чтения ----------------------------------------------------------------

export async function listTasks(filters: ListFilters): Promise<TaskListWire[]> {
  const and: Prisma.TaskWhereInput[] = [];

  if (filters.undatedOnly) {
    and.push({ scheduledDate: null });
  } else if (filters.date) {
    const d = parseDate(filters.date);
    and.push(
      filters.includeUndated
        ? { OR: [{ scheduledDate: d }, { scheduledDate: null }] }
        : { scheduledDate: d },
    );
  } else if (filters.dateFrom || filters.dateTo) {
    const range: Prisma.DateTimeNullableFilter = {};
    const from = parseDate(filters.dateFrom);
    const to = parseDate(filters.dateTo);
    if (from) range.gte = from;
    if (to) range.lte = to;
    // includeUndated добавляет пул «Без даты» к диапазону (доска «Сегодня»: сегодня…+2 + без даты).
    and.push(
      filters.includeUndated
        ? { OR: [{ scheduledDate: range }, { scheduledDate: null }] }
        : { scheduledDate: range },
    );
  }

  if (filters.assigneeId === "none") and.push({ assigneeId: null });
  else if (filters.assigneeId) and.push({ assigneeId: filters.assigneeId });

  if (filters.status) and.push({ status: filters.status });
  if (filters.typeId) and.push({ typeId: filters.typeId });

  const q = filters.q?.trim();
  if (q) {
    const or: Prisma.TaskWhereInput[] = [
      { title: { contains: q, mode: "insensitive" } },
      { orgName: { contains: q, mode: "insensitive" } },
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
    ];
    const asNumber = Number.parseInt(q, 10);
    if (!Number.isNaN(asNumber)) or.push({ number: asNumber });
    and.push({ OR: or });
  }

  const rows = await prisma.task.findMany({
    where: and.length ? { AND: and } : {},
    include: taskListInclude,
    orderBy: [{ priority: "desc" }, { scheduledDate: "asc" }, { number: "asc" }],
  });
  return rows.map(withActFlag);
}

/**
 * Список задач водителя для PWA (ARCHITECTURE §6, §7). ЖЁСТКАЯ изоляция: where прибит к
 * actor.id через myTasksWhere — другого пути выборки нет. Личность приходит из сессии
 * (route handler), `today` — локальная дата клиента «YYYY-MM-DD».
 */
export async function listMyTasks(
  actor: Actor,
  opts: { today: string; scope?: MyTasksScope },
): Promise<TaskListWire[]> {
  const today = parseDate(opts.today);
  if (!today) throw Errors.validation("Некорректная дата");
  const rows = await prisma.task.findMany({
    where: myTasksWhere(actor.id, today, opts.scope ?? "today"),
    include: taskListInclude,
    orderBy: [
      { priority: "desc" },
      { scheduledDate: "asc" },
      { timeFrom: "asc" },
      { number: "asc" },
    ],
  });
  return rows.map(withActFlag);
}

export type BoardAttention = {
  overdue: TaskListWire[]; // незавершённые с прошедшей датой
  tomorrowPasses: TaskListWire[]; // на завтра пропуск «нужен, не заказан» (PRD §6)
};

/**
 * Блок «Требуют внимания» для доски диспетчера (Этап 6). Только для диспетчера/админа —
 * вызывается из эндпоинта за requireDispatcher (он видит все задачи, PRD §2).
 * `today` — локальная дата клиента «YYYY-MM-DD»; завтра считаем как today+1 (UTC, как @db.Date).
 */
export async function listAttention(today: string): Promise<BoardAttention> {
  const todayDate = parseDate(today);
  if (!todayDate) throw Errors.validation("Некорректная дата");
  const tomorrow = new Date(todayDate);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [overdue, tomorrowPasses] = await Promise.all([
    prisma.task.findMany({
      where: overdueWhere(todayDate),
      include: taskListInclude,
      orderBy: [{ scheduledDate: "asc" }, { priority: "desc" }, { number: "asc" }],
    }),
    prisma.task.findMany({
      where: tomorrowPassWhere(tomorrow),
      include: taskListInclude,
      orderBy: [{ priority: "desc" }, { number: "asc" }],
    }),
  ]);
  return { overdue: overdue.map(withActFlag), tomorrowPasses: tomorrowPasses.map(withActFlag) };
}

/** Карточка задачи с историей. Изоляция: водителю чужая задача отдаёт 404. */
export async function getTaskById(taskId: string, actor: Actor): Promise<TaskDetailWire> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskDetailInclude });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound();
  // Диспетчеру/админу подставляем цену-подсказку из справочника к позициям ведомости (для расценки).
  // Водителю — НЕ отдаём (PRD §13: цены ему не видны). Поэтому это отдельный шаг, а не общий include.
  if (!isDispatcherRole(actor.role)) return task;
  const ids = [
    ...new Set(task.workItems.map((w) => w.catalogItemId).filter((x): x is string => x !== null)),
  ];
  if (ids.length === 0) return task;
  const hints = await prisma.workCatalogItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, defaultPrice: true },
  });
  const priceById = new Map(hints.map((h) => [h.id, h.defaultPrice]));
  return {
    ...task,
    workItems: task.workItems.map((w) => ({
      ...w,
      defaultPrice: w.catalogItemId ? (priceById.get(w.catalogItemId) ?? null) : null,
    })),
  };
}

// --- Записи ----------------------------------------------------------------

export async function createTask(
  input: Partial<CreateTaskInput>,
  actor: Actor,
): Promise<TaskListItem> {
  if (!isDispatcherRole(actor.role)) throw Errors.forbidden();

  const typeId = input.typeId;
  const title = clean(input.title);
  const address = clean(input.address);
  if (!typeId) throw Errors.validation("Не выбран тип задачи");
  if (!title) throw Errors.validation("Не указано название");
  if (!address) throw Errors.validation("Не указан адрес");

  // Тип задаёт дефолт требования акта; диспетчер может снять его галочкой «акт не нужен» (PRD §4).
  const type = await prisma.taskType.findUnique({
    where: { id: typeId },
    select: { requiresSignedDoc: true, requiresPricing: true, onSiteMinutes: true },
  });
  if (!type) throw Errors.validation("Неизвестный тип задачи");
  const requiresSignedDoc =
    input.requiresAct === undefined || input.requiresAct === null ? type.requiresSignedDoc : input.requiresAct;
  // Причину снятия храним, только когда акт реально сняли с типа, который его ожидал.
  const actWaivedNote = !requiresSignedDoc && type.requiresSignedDoc ? clean(input.actWaivedNote) : null;
  // Ведомость работ заводится сразу в DRAFT для типов с расценкой (этап 12, PRD §13).
  const worksheetStatus: WorksheetStatus | null = type.requiresPricing ? "DRAFT" : null;

  let assigneeId: string | null = null;
  if (input.assigneeId) {
    assigneeId = await assertAssignableDriver(input.assigneeId);
  }
  const status: TaskStatus = assigneeId ? "ASSIGNED" : "NEW";

  // Оценка времени (Фаза 2, PRD §14): геокодируем адрес и считаем «норма типа + дорога».
  // Геокод и расчёт — ДО транзакции (внешний вызов не держит БД). Сбой геокодера → дорога не учтена.
  const timeFromClean = clean(input.timeFrom);
  const point = await geocodeAddress(address);
  const estimate = await computeEstimate({
    onSiteMinutes: type.onSiteMinutes,
    point,
    timeFrom: timeFromClean,
  });

  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        typeId,
        title,
        address,
        description: clean(input.description),
        equipment: clean(input.equipment),
        orgName: clean(input.orgName),
        contactName: clean(input.contactName),
        contactPhone: clean(input.contactPhone),
        addressLink: clean(input.addressLink),
        invoiceNumber: clean(input.invoiceNumber),
        paymentType: input.paymentType ?? "NONE",
        paymentAmount: input.paymentAmount ?? null,
        paymentNote: clean(input.paymentNote),
        scheduledDate: parseDate(input.scheduledDate),
        timeFrom: timeFromClean,
        timeTo: clean(input.timeTo),
        timeNote: clean(input.timeNote),
        passStatus: input.passStatus ?? "NOT_NEEDED",
        priority: input.priority ?? false,
        requiresSignedDoc,
        actWaivedNote,
        worksheetStatus,
        status,
        assigneeId,
        // Ёмкость (Фаза 2): координаты геокода + авто-оценка времени (estimateIsManual=false).
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        estimatedMinutes: estimate.totalMinutes,
        createdById: actor.id,
      },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        actorId: actor.id,
        kind: "created",
        toStatus: status,
        comment: assigneeId ? "Создана и назначена" : "Создана",
      },
    });
    return task;
  });
  // Пуш назначенному водителю (PRD §7). notifyTaskAssignee — no-op, если задача не назначена.
  notifyTaskAssignee(created, "assigned", actor.id);
  return created;
}

export async function updateTaskFields(
  taskId: string,
  fields: Partial<CreateTaskInput>,
  actor: Actor,
): Promise<TaskListItem> {
  if (!isDispatcherRole(actor.role)) throw Errors.forbidden();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();

  const data: Prisma.TaskUpdateInput = {};
  const set = <K extends keyof CreateTaskInput>(key: K, apply: (v: NonNullable<CreateTaskInput[K]> | null) => void) => {
    if (fields[key] !== undefined) apply((fields[key] ?? null) as NonNullable<CreateTaskInput[K]> | null);
  };

  if (fields.title !== undefined) {
    const t = clean(fields.title);
    if (!t) throw Errors.validation("Название не может быть пустым");
    data.title = t;
  }
  let addressChanged = false;
  let effectiveAddress = task.address;
  if (fields.address !== undefined) {
    const a = clean(fields.address);
    if (!a) throw Errors.validation("Адрес не может быть пустым");
    data.address = a;
    addressChanged = a !== task.address;
    effectiveAddress = a;
  }
  if (fields.typeId !== undefined && fields.typeId) data.type = { connect: { id: fields.typeId } };
  set("description", (v) => (data.description = v));
  set("equipment", (v) => (data.equipment = v));
  set("orgName", (v) => (data.orgName = v));
  set("contactName", (v) => (data.contactName = v));
  set("contactPhone", (v) => (data.contactPhone = v));
  set("addressLink", (v) => (data.addressLink = v));
  set("invoiceNumber", (v) => (data.invoiceNumber = v));
  if (fields.paymentType !== undefined) data.paymentType = fields.paymentType;
  if (fields.paymentAmount !== undefined) data.paymentAmount = fields.paymentAmount ?? null;
  set("paymentNote", (v) => (data.paymentNote = v));
  if (fields.scheduledDate !== undefined) data.scheduledDate = parseDate(fields.scheduledDate);
  set("timeFrom", (v) => (data.timeFrom = v));
  set("timeTo", (v) => (data.timeTo = v));
  set("timeNote", (v) => (data.timeNote = v));
  if (fields.passStatus !== undefined) data.passStatus = fields.passStatus;
  if (fields.priority !== undefined) data.priority = fields.priority;
  if (fields.requiresAct !== undefined) {
    const req = fields.requiresAct ?? false;
    data.requiresSignedDoc = req;
    data.actWaivedNote = req ? null : clean(fields.actWaivedNote);
  }

  // --- Оценка времени (Фаза 2, PRD §14) ---
  // Ручная оценка диспетчера: number → фиксируем (manual, не пересчитываем); null → сброс к авто.
  const resetToAuto = fields.estimatedMinutes === null;
  let willBeManual = task.estimateIsManual;
  if (fields.estimatedMinutes !== undefined && fields.estimatedMinutes !== null) {
    const minutes = Math.round(fields.estimatedMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) throw Errors.validation("Некорректная оценка времени");
    data.estimatedMinutes = minutes;
    data.estimateIsManual = true;
    willBeManual = true;
  } else if (resetToAuto) {
    willBeManual = false;
  }

  // Авто-пересчёт нужен, когда оценка не ручная и поменялось что-то влияющее (адрес/тип/время выезда),
  // либо диспетчер явно сбросил к авто. Дата на величину оценки не влияет (пробки — по времени суток).
  const typeChanged = fields.typeId !== undefined && !!fields.typeId && fields.typeId !== task.typeId;
  const timeFromChanged = fields.timeFrom !== undefined && clean(fields.timeFrom) !== task.timeFrom;
  if (!willBeManual && (addressChanged || typeChanged || timeFromChanged || resetToAuto)) {
    const effectiveTypeId = fields.typeId ?? task.typeId;
    const t = await prisma.taskType.findUnique({
      where: { id: effectiveTypeId },
      select: { onSiteMinutes: true },
    });
    const onSiteMinutes = t?.onSiteMinutes ?? 30;
    const effectiveTimeFrom = fields.timeFrom !== undefined ? clean(fields.timeFrom) : task.timeFrom;
    // При смене адреса геокодируем заново (и обновляем lat/lng); иначе берём сохранённые координаты.
    let point: LatLng | null;
    if (addressChanged) {
      point = await geocodeAddress(effectiveAddress);
      data.lat = point?.lat ?? null;
      data.lng = point?.lng ?? null;
    } else {
      point = task.lat != null && task.lng != null ? { lat: task.lat, lng: task.lng } : null;
    }
    const estimate = await computeEstimate({ onSiteMinutes, point, timeFrom: effectiveTimeFrom });
    data.estimatedMinutes = estimate.totalMinutes;
    data.estimateIsManual = false;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data, include: taskInclude });
    await tx.taskEvent.create({
      data: { taskId, actorId: actor.id, kind: "edit", comment: "Изменены поля задачи" },
    });
    return updated;
  });
  notifyTaskAssignee(result, "changed", actor.id);
  return result;
}

/** preflight-аудит В3: у исполнителя не может быть двух задач «В работе» одновременно. Проверяется
 *  при переназначении АКТИВНОЙ (IN_PROGRESS) задачи на другого водителя — assign/plan меняют только
 *  assigneeId, не трогая статус, поэтому инвариант ACTIVE_TASK_EXISTS (он же в transitionTask)
 *  дублируется здесь. Снятие назначения и неактивные задачи не затрагиваются. */
async function assertNoOtherActiveTask(
  taskId: string,
  newAssigneeId: string | null,
  currentAssigneeId: string | null,
  status: TaskStatus,
): Promise<void> {
  if (!newAssigneeId || newAssigneeId === currentAssigneeId || status !== "IN_PROGRESS") return;
  const other = await prisma.task.findFirst({
    where: { assigneeId: newAssigneeId, status: "IN_PROGRESS", id: { not: taskId } },
    select: { number: true },
  });
  if (other) throw Errors.activeTaskExists(other.number);
}

export async function assignTask(
  taskId: string,
  assigneeId: string | null,
  actor: Actor,
  opts: { today?: string } = {},
): Promise<TaskListItem> {
  if (!isDispatcherRole(actor.role)) throw Errors.forbidden();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (task.status === "DONE" || task.status === "CANCELLED") throw Errors.invalidTransition();

  let name = "";
  if (assigneeId) {
    await assertAssignableDriver(assigneeId);
    const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } });
    name = u?.name ?? "";
  }

  // Перенос активной задачи другому водителю не должен дать ему вторую «В работе» (В3).
  await assertNoOtherActiveTask(taskId, assigneeId, task.assigneeId, task.status);

  // Назначение задаёт ASSIGNED для новой; снятие назначения возвращает в NEW.
  let status = task.status;
  if (assigneeId && task.status === "NEW") status = "ASSIGNED";
  if (!assigneeId && task.status === "ASSIGNED") status = "NEW";

  // п.1: назначение задачи БЕЗ даты на водителя автоматически ставит сегодняшнюю дату.
  // `today` — локальная дата клиента «YYYY-MM-DD»; если не передана, берём дату сервера (UTC) как запас.
  const today = parseDate(opts.today) ?? parseDate(new Date().toISOString().slice(0, 10));
  const autoDate = resolveAssignedDate(task.scheduledDate, assigneeId, today);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { assigneeId, status, ...(autoDate ? { scheduledDate: autoDate } : {}) },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: "assign",
        fromStatus: task.status,
        toStatus: status,
        comment: assigneeId ? `Назначен: ${name}` : "Снято назначение",
      },
    });
    // Отдельная неизменяемая отметка в журнал об авто-простановке даты (CLAUDE.md правило 3).
    if (autoDate) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "auto_date",
          comment: `Дата проставлена автоматически при назначении: ${autoDate.toISOString().slice(0, 10)}`,
        },
      });
    }
    return updated;
  });
  // Назначение → пуш новому исполнителю; снятие назначения (assigneeId=null) — no-op.
  notifyTaskAssignee(result, "assigned", actor.id);
  return result;
}

/**
 * Планирование задачи на сетке «Планирование» (п.3): атомарно задаёт дату И исполнителя
 * (перетаскивание в ячейку «день × водитель»). Дата — edit-поле, назначение — ось NEW↔ASSIGNED
 * (как assignTask), матрица статусов не обходится. Пишет осмысленные события за реальные изменения.
 */
export async function planTask(
  taskId: string,
  input: { scheduledDate: string | null; assigneeId: string | null },
  actor: Actor,
): Promise<TaskListItem> {
  if (!isDispatcherRole(actor.role)) throw Errors.forbidden();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (task.status === "DONE" || task.status === "CANCELLED") throw Errors.invalidTransition();

  const newDate = parseDate(input.scheduledDate);
  const assigneeId = input.assigneeId ?? null;

  let name = "";
  if (assigneeId) {
    await assertAssignableDriver(assigneeId);
    const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } });
    name = u?.name ?? "";
  }

  // Перенос активной задачи другому водителю не должен дать ему вторую «В работе» (В3).
  await assertNoOtherActiveTask(taskId, assigneeId, task.assigneeId, task.status);

  // Статус по оси назначения (как в assignTask): NEW↔ASSIGNED, прочие статусы не трогаем.
  let status = task.status;
  if (assigneeId && task.status === "NEW") status = "ASSIGNED";
  if (!assigneeId && task.status === "ASSIGNED") status = "NEW";

  const dateKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const dateChanged = dateKey(task.scheduledDate) !== dateKey(newDate);
  const assigneeChanged = (task.assigneeId ?? null) !== assigneeId;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { scheduledDate: newDate, assigneeId, status },
      include: taskInclude,
    });
    if (dateChanged) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "reschedule",
          fromStatus: task.status,
          toStatus: status,
          comment: newDate
            ? `Запланирована на ${dateKey(newDate)}`
            : "Дата снята (пул «Без даты»)",
        },
      });
    }
    if (assigneeChanged) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "assign",
          fromStatus: task.status,
          toStatus: status,
          comment: assigneeId ? `Назначен: ${name}` : "Снято назначение",
        },
      });
    }
    return updated;
  });
  // Пуш новому исполнителю при назначении/смене (no-op, если назначения нет).
  if (assigneeChanged) notifyTaskAssignee(result, "assigned", actor.id);
  else if (dateChanged) notifyTaskAssignee(result, "rescheduled", actor.id);
  return result;
}

export type TransitionOptions = {
  comment?: string | null;
  reason?: string | null;
  lat?: number | null;
  lng?: number | null;
  paymentConfirmed?: boolean; // DONE при оплате «на месте»: подтверждение получения денег (PRD §5)
  paymentAmount?: number | null; // фактически полученная сумма (по умолчанию — ожидаемая из задачи)
  paymentMissedReason?: string | null; // DONE при ON_SITE без оплаты: причина неоплаты (№8)
  actMissedReason?: string | null; // DONE актовой задачи без акта: причина водителя (акты до 20:00, 02.07)
  // Офлайн-режим: ISO-время момента действия на телефоне. Пишется в TaskEvent.at (и completedAt при
  // DONE) вместо времени досылки, с проверкой достоверности (src/domain/occurred-at.ts).
  occurredAt?: string | null;
};

export async function transitionTask(
  taskId: string,
  toStatus: TaskStatus,
  actor: Actor,
  opts: TransitionOptions = {},
): Promise<TaskListItem> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound(); // изоляция: чужая → 404

  const isAssignee = task.assigneeId !== null && task.assigneeId === actor.id;
  const verdict = checkTransition({ role: actor.role, isAssignee }, task.status, toStatus);
  if (!verdict.ok) throw Errors.invalidTransition();

  const reason = clean(opts.reason) ?? clean(opts.comment);
  if (verdict.reasonRequired && !reason) throw Errors.reasonRequired();

  // Завершение (DONE) при оплате «на месте» (№8, решение Артёма 23.06): жёсткого запрета завершить
  // без денег больше нет. Но водитель обязан отметить ОДНО из двух — деньги получены ЛИБО не получены
  // с причиной (чтобы инфа не терялась). Без выбора — просим определиться (это не возврат старого гейта).
  // Фото — по желанию (не блокирует); требуемый акт — мягкая отметка KPI, не запрет.
  const unpaidReason =
    toStatus === "DONE" && task.paymentType === "ON_SITE" ? clean(opts.paymentMissedReason) : null;
  if (toStatus === "DONE" && task.paymentType === "ON_SITE" && !opts.paymentConfirmed && !unpaidReason) {
    throw Errors.paymentRequired();
  }

  // Акты до 20:00 (решение Артёма 02.07): водитель, завершая актовую задачу БЕЗ приложенного акта,
  // обязан выбрать причину. Причина информационная — завершение не блокируется, кандидата KPI создаст
  // детектор независимо от неё. Диспетчера не спрашиваем (он «и есть офис», ведёт статусы за внешних).
  let actReason: string | null = null;
  if (toStatus === "DONE" && task.requiresSignedDoc && actor.role === "DRIVER") {
    const docs = await prisma.attachment.count({ where: { taskId, kind: "DOCUMENT" } });
    if (docs === 0) {
      actReason = clean(opts.actMissedReason);
      if (!actReason) throw Errors.actReasonRequired();
    }
  }

  // Взятие/возобновление работы (→IN_PROGRESS): требуется открытая смена + одна активная задача.
  if (toStatus === "IN_PROGRESS" && task.assigneeId) {
    // Требование открытой смены — только когда ВОДИТЕЛЬ берёт СВОЮ задачу (решение Артёма 19.06.2026).
    // Диспетчер ведёт статусы за исполнителя (в т.ч. внешнего перевозчика без смены) — его не блокируем.
    if (actor.role === "DRIVER" && actor.id === task.assigneeId) {
      const shift = await prisma.shift.findFirst({
        where: { driverId: task.assigneeId, status: { in: ["REQUESTED", "OPEN"] } },
        select: { id: true },
      });
      if (!shift) throw Errors.shiftRequired();
    }
    // Одна активная задача (этап B): у исполнителя не больше одной задачи «В работе» одновременно.
    // Правило по assigneeId — работает и когда водитель берёт сам, и когда диспетчер ведёт за исполнителя.
    const other = await prisma.task.findFirst({
      where: { assigneeId: task.assigneeId, status: "IN_PROGRESS", id: { not: taskId } },
      select: { number: true },
    });
    if (other) throw Errors.activeTaskExists(other.number);
  }

  // Время события: момент действия на телефоне (офлайн) с проверкой достоверности, иначе — сервера.
  const at = resolveOccurredAt(opts.occurredAt);
  const data: Prisma.TaskUpdateInput = { status: toStatus };
  if (toStatus === "ON_HOLD") data.holdReason = reason;
  if (toStatus === "CANCELLED") data.cancelReason = reason;
  // Офлайн: completedAt = момент действия на телефоне (occurredAt), а не время досылки.
  if (toStatus === "DONE") data.completedAt = at;
  // Факт оплаты при ON_SITE-завершении (№8): получено / не получено + причина — сохраняем на задаче.
  if (toStatus === "DONE" && task.paymentType === "ON_SITE") {
    data.paymentReceived = opts.paymentConfirmed === true;
    data.paymentMissedReason = opts.paymentConfirmed ? null : unpaidReason;
  }
  // Причина «завершил без акта» — снимок на задаче (как paymentMissedReason): детектор KPI дотянется
  // простым select, Милена увидит в note кандидата.
  if (actReason) data.actMissedReason = actReason;
  if (task.status === "ON_HOLD" && toStatus === "ASSIGNED") data.holdReason = null;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data, include: taskInclude });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: "status_change",
        fromStatus: task.status,
        toStatus,
        comment: reason ?? clean(opts.comment),
        lat: opts.lat ?? null,
        lng: opts.lng ?? null,
        at,
      },
    });
    // Оплата на месте подтверждена — отдельная неизменяемая отметка в журнал (PRD §5).
    if (toStatus === "DONE" && task.paymentType === "ON_SITE" && opts.paymentConfirmed) {
      const amount = opts.paymentAmount ?? task.paymentAmount ?? null;
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "payment_received",
          comment: amount != null ? `Деньги получены: ${amount} ₽` : "Деньги получены",
          lat: opts.lat ?? null,
          lng: opts.lng ?? null,
          at,
        },
      });
    }
    // Завершено без оплаты «на месте» (№8) — неизменяемая отметка с причиной: инфа не теряется,
    // диспетчер её видит. Без штрафа KPI (решение Артёма) — это просто факт в журнале и на задаче.
    if (toStatus === "DONE" && task.paymentType === "ON_SITE" && !opts.paymentConfirmed && unpaidReason) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "payment_unpaid",
          comment: `Деньги не получены: ${unpaidReason}`,
          lat: opts.lat ?? null,
          lng: opts.lng ?? null,
          at, // офлайн: момент действия на телефоне, не досылки
        },
      });
    }
    // Завершено без акта (акты до 20:00, 02.07) — неизменяемая отметка с причиной водителя.
    if (actReason) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "act_missing_reason",
          comment: `Акт не приложен: ${actReason}`,
          lat: opts.lat ?? null,
          lng: opts.lng ?? null,
          at,
        },
      });
    }
    return updated;
  });
  // Отмена диспетчером → пуш водителю (PRD §7). Движение статуса вперёд самим водителем не шлём.
  if (toStatus === "CANCELLED") notifyTaskAssignee(result, "cancelled", actor.id);
  return result;
}

export async function rescheduleTask(
  taskId: string,
  newDate: string,
  actor: Actor,
  comment?: string | null,
): Promise<TaskListItem> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound();

  const isAssignee = task.assigneeId !== null && task.assigneeId === actor.id;
  const verdict = checkTransition({ role: actor.role, isAssignee }, task.status, "RESCHEDULED");
  if (!verdict.ok) throw Errors.invalidTransition();

  const date = parseDate(newDate);
  if (!date) throw Errors.dateRequired();

  // «Перенесена» возвращает задачу в «Назначена» на новую дату (PRD §5), снимая паузу.
  const status: TaskStatus = task.assigneeId ? "ASSIGNED" : "NEW";

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { scheduledDate: date, status, holdReason: null },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: "reschedule",
        fromStatus: task.status,
        toStatus: status,
        comment: clean(comment) ?? `Перенесена на ${newDate}`,
      },
    });
    return updated;
  });
  notifyTaskAssignee(result, "rescheduled", actor.id);
  return result;
}

export async function addComment(
  taskId: string,
  text: string,
  actor: Actor,
  opts: { lat?: number | null; lng?: number | null; occurredAt?: string | null } = {},
): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound();
  const comment = clean(text);
  if (!comment) throw Errors.validation("Пустой комментарий");

  await prisma.taskEvent.create({
    data: {
      taskId,
      actorId: actor.id,
      kind: "comment",
      comment,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      at: resolveOccurredAt(opts.occurredAt), // офлайн: момент написания, не досылки
    },
  });
}

// Проверяет, что назначаемый — активный водитель. Возвращает его id.
async function assertAssignableDriver(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!u || u.role !== "DRIVER" || !u.isActive) {
    throw Errors.validation("Назначить можно только активного водителя");
  }
  return u.id;
}
