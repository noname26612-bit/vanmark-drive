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
import { notifyTaskAssignee } from "@/lib/push";

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

// Краткие связи для карточек/списков.
const taskInclude = {
  type: true,
  assignee: { select: { id: true, name: true, login: true } },
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
      sortOrder: true,
      createdById: true,
      createdAt: true,
    },
  },
} satisfies Prisma.TaskInclude;

export type TaskListItem = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
export type TaskDetail = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

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

export async function listTasks(filters: ListFilters): Promise<TaskListItem[]> {
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

  return prisma.task.findMany({
    where: and.length ? { AND: and } : {},
    include: taskInclude,
    orderBy: [{ priority: "desc" }, { scheduledDate: "asc" }, { number: "asc" }],
  });
}

/**
 * Список задач водителя для PWA (ARCHITECTURE §6, §7). ЖЁСТКАЯ изоляция: where прибит к
 * actor.id через myTasksWhere — другого пути выборки нет. Личность приходит из сессии
 * (route handler), `today` — локальная дата клиента «YYYY-MM-DD».
 */
export async function listMyTasks(
  actor: Actor,
  opts: { today: string; scope?: MyTasksScope },
): Promise<TaskListItem[]> {
  const today = parseDate(opts.today);
  if (!today) throw Errors.validation("Некорректная дата");
  return prisma.task.findMany({
    where: myTasksWhere(actor.id, today, opts.scope ?? "today"),
    include: taskInclude,
    orderBy: [
      { priority: "desc" },
      { scheduledDate: "asc" },
      { timeFrom: "asc" },
      { number: "asc" },
    ],
  });
}

export type BoardAttention = {
  overdue: TaskListItem[]; // незавершённые с прошедшей датой
  tomorrowPasses: TaskListItem[]; // на завтра пропуск «нужен, не заказан» (PRD §6)
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
      include: taskInclude,
      orderBy: [{ scheduledDate: "asc" }, { priority: "desc" }, { number: "asc" }],
    }),
    prisma.task.findMany({
      where: tomorrowPassWhere(tomorrow),
      include: taskInclude,
      orderBy: [{ priority: "desc" }, { number: "asc" }],
    }),
  ]);
  return { overdue, tomorrowPasses };
}

/** Карточка задачи с историей. Изоляция: водителю чужая задача отдаёт 404. */
export async function getTaskById(taskId: string, actor: Actor): Promise<TaskDetail> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskDetailInclude });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound();
  return task;
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
    select: { requiresSignedDoc: true, requiresPricing: true },
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
        timeFrom: clean(input.timeFrom),
        timeTo: clean(input.timeTo),
        timeNote: clean(input.timeNote),
        passStatus: input.passStatus ?? "NOT_NEEDED",
        priority: input.priority ?? false,
        requiresSignedDoc,
        actWaivedNote,
        worksheetStatus,
        status,
        assigneeId,
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
  if (fields.address !== undefined) {
    const a = clean(fields.address);
    if (!a) throw Errors.validation("Адрес не может быть пустым");
    data.address = a;
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

  // Завершение (DONE): серверный гейт — только подтверждение оплаты «на месте» (PRD §5).
  // Фото с этапа 11 — по желанию (не блокирует); требуемый акт — мягкая отметка KPI, не запрет.
  if (toStatus === "DONE" && task.paymentType === "ON_SITE" && !opts.paymentConfirmed) {
    throw Errors.paymentRequired();
  }

  const data: Prisma.TaskUpdateInput = { status: toStatus };
  if (toStatus === "ON_HOLD") data.holdReason = reason;
  if (toStatus === "CANCELLED") data.cancelReason = reason;
  if (toStatus === "DONE") data.completedAt = new Date();
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
  opts: { lat?: number | null; lng?: number | null } = {},
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
