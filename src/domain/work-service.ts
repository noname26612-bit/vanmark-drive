// Доменный сервис ведомости работ (этап 12, PRD §13). Водитель фиксирует ВЫПОЛНЕННЫЕ работы и
// количество — БЕЗ цен; цену проставляет диспетчер при расценке (этап 13). Изоляция как у задач:
// водитель работает только со своей задачей (canViewTask → чужая отдаёт 404). Правка возможна,
// только пока ведомость в DRAFT; после «Отправить на расценку» (PRICING) — заблокировано.
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { Role, WorksheetStatus } from "@/generated/prisma/enums";
import { canViewTask } from "./authz";
import { isDispatcherRole } from "./task-status";
import { Errors } from "./errors";
import { notifyDispatchers, notifyTaskAssignee } from "@/lib/push";

export type Actor = { id: string; role: Role };

function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ───────────────────────────── Справочник работ ─────────────────────────────

// Справочник для ВОДИТЕЛЯ: только id+name — цену-подсказку (defaultPrice) водителю НЕ отдаём
// (PRD §13: водитель не формирует и не видит цены до расценки). Цены — у диспетчера/админа.
export function listWorkCatalog() {
  return prisma.workCatalogItem.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

// Полный справочник для АДМИНА (включая defaultPrice и скрытые позиции).
export function listAllWorkCatalog() {
  return prisma.workCatalogItem.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export type WorkCatalogInput = {
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  defaultPrice?: number | null; // цена-подсказка ₽/ед (этап «справочник»): null — без подсказки
};

// Нормализует цену-подсказку: null оставляем, число — целое ≥0.
function cleanPrice(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.max(0, Math.trunc(v));
}

export async function createWorkCatalogItem(input: Partial<WorkCatalogInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const name = clean(input.name);
  if (!name) throw Errors.validation("Название работы не может быть пустым");
  if (await prisma.workCatalogItem.findUnique({ where: { name } })) {
    throw Errors.validation("Работа с таким названием уже есть");
  }
  return prisma.workCatalogItem.create({
    data: {
      name,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      defaultPrice: cleanPrice(input.defaultPrice),
    },
  });
}

export async function updateWorkCatalogItem(id: string, input: Partial<WorkCatalogInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const existing = await prisma.workCatalogItem.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound();
  const data: { name?: string; isActive?: boolean; sortOrder?: number; defaultPrice?: number | null } = {};
  if (input.name !== undefined) {
    const name = clean(input.name);
    if (!name) throw Errors.validation("Название работы не может быть пустым");
    if (name !== existing.name && (await prisma.workCatalogItem.findUnique({ where: { name } }))) {
      throw Errors.validation("Работа с таким названием уже есть");
    }
    data.name = name;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.defaultPrice !== undefined) data.defaultPrice = cleanPrice(input.defaultPrice);
  return prisma.workCatalogItem.update({ where: { id }, data });
}

// ───────────────────────────── Ведомость задачи ─────────────────────────────

// Загружает задачу с проверкой доступа (изоляция: чужая → 404) и флага requiresPricing.
async function loadTaskForWorksheet(taskId: string, actor: Actor) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { type: { select: { requiresPricing: true } } },
  });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound();
  return task;
}

export async function listWorkItems(taskId: string, actor: Actor) {
  await loadTaskForWorksheet(taskId, actor);
  return prisma.workItem.findMany({ where: { taskId }, orderBy: { sortOrder: "asc" } });
}

export type WorkItemInput = { catalogItemId?: string | null; name?: string | null; quantity?: number };

// Правка ведомости разрешена только пока она не отправлена на расценку (DRAFT или ещё не начата).
function assertEditable(status: WorksheetStatus | null): void {
  if (status && status !== "DRAFT") throw Errors.worksheetLocked();
}

export async function addWorkItem(taskId: string, input: WorkItemInput, actor: Actor) {
  const task = await loadTaskForWorksheet(taskId, actor);
  if (!task.type.requiresPricing) throw Errors.validation("Для этого типа задачи ведомость не нужна");
  assertEditable(task.worksheetStatus);

  // Название позиции: снимок из справочника, либо свободный ввод (catalogItemId=null).
  let name = clean(input.name);
  let catalogItemId: string | null = null;
  if (input.catalogItemId) {
    const item = await prisma.workCatalogItem.findUnique({ where: { id: input.catalogItemId } });
    if (!item || !item.isActive) throw Errors.validation("Работа из справочника не найдена");
    catalogItemId = item.id;
    name = item.name;
  }
  if (!name) throw Errors.validation("Укажите работу — из справочника или текстом");
  const quantity = Math.max(1, Math.trunc(input.quantity ?? 1));

  const last = await prisma.workItem.findFirst({
    where: { taskId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = (last?.sortOrder ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    const created = await tx.workItem.create({
      data: { taskId, catalogItemId, name, quantity, sortOrder, createdById: actor.id },
    });
    // Первая позиция инициализирует ведомость в DRAFT.
    if (task.worksheetStatus === null) {
      await tx.task.update({ where: { id: taskId }, data: { worksheetStatus: "DRAFT" } });
    }
    return created;
  });
}

export async function updateWorkItem(id: string, input: WorkItemInput, actor: Actor) {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw Errors.notFound();
  const task = await loadTaskForWorksheet(item.taskId, actor);
  assertEditable(task.worksheetStatus);

  const data: { name?: string; quantity?: number } = {};
  // Переименовать можно только свободную строку; у позиции из справочника название — снимок.
  if (input.name !== undefined && item.catalogItemId === null) {
    const name = clean(input.name);
    if (!name) throw Errors.validation("Название работы не может быть пустым");
    data.name = name;
  }
  if (input.quantity !== undefined) data.quantity = Math.max(1, Math.trunc(input.quantity));
  return prisma.workItem.update({ where: { id }, data });
}

export async function removeWorkItem(id: string, actor: Actor) {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw Errors.notFound();
  const task = await loadTaskForWorksheet(item.taskId, actor);
  assertEditable(task.worksheetStatus);
  await prisma.workItem.delete({ where: { id } });
}

export async function submitWorksheet(taskId: string, actor: Actor) {
  const task = await loadTaskForWorksheet(taskId, actor);
  if (!task.type.requiresPricing) throw Errors.validation("Для этого типа задачи ведомость не нужна");
  if (task.worksheetStatus && task.worksheetStatus !== "DRAFT") throw Errors.worksheetLocked();
  const count = await prisma.workItem.count({ where: { taskId } });
  if (count === 0) throw Errors.validation("Добавьте хотя бы одну работу перед отправкой");

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data: { worksheetStatus: "PRICING" } });
    await tx.taskEvent.create({
      data: { taskId, actorId: actor.id, kind: "worksheet_submitted", comment: "Ведомость отправлена на расценку" },
    });
    return updated;
  });
  // Пуш диспетчерам: водитель ждёт цен (этап 13, PRD §13.1).
  notifyDispatchers({ id: task.id, number: task.number, title: task.title });
  return result;
}

export type PricingInput = { items: { id: string; price: number }[] };

// Диспетчер проставляет цены по позициям и подтверждает расценку (PRICING→PRICED). Только диспетчер/админ.
export async function priceWorksheet(taskId: string, input: PricingInput, actor: Actor) {
  if (!isDispatcherRole(actor.role)) throw Errors.forbidden();
  const task = await loadTaskForWorksheet(taskId, actor);
  if (!task.type.requiresPricing) throw Errors.validation("Для этого типа задачи расценка не нужна");
  if (task.worksheetStatus !== "PRICING" && task.worksheetStatus !== "PRICED") {
    throw Errors.validation("Ведомость ещё не отправлена на расценку");
  }
  // Применяем цены только к позициям этой задачи (защита от чужих id в теле запроса).
  const existing = await prisma.workItem.findMany({ where: { taskId }, select: { id: true } });
  const ids = new Set(existing.map((i) => i.id));
  const updates = input.items.filter((u) => ids.has(u.id));

  const result = await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.workItem.update({ where: { id: u.id }, data: { price: Math.max(0, Math.trunc(u.price)) } });
    }
    const updated = await tx.task.update({ where: { id: taskId }, data: { worksheetStatus: "PRICED" } });
    await tx.taskEvent.create({
      data: { taskId, actorId: actor.id, kind: "worksheet_priced", comment: "Ведомость расценена" },
    });
    return updated;
  });
  // Пуш водителю: цены готовы (этап 13).
  notifyTaskAssignee(
    { id: task.id, number: task.number, title: task.title, assigneeId: task.assigneeId },
    "priced",
    actor.id,
  );
  return result;
}

// ───────────────────────────── Подписание акта (этап 14, PRD §13.4) ─────────────────────────────
// Приложение фото подписанного бумажного акта закрывает цикл ведомости: PRICED → SIGNED. Вызывается
// из attachment-service при добавлении/удалении DOCUMENT-вложения, ВНУТРИ его транзакции. Обе
// функции читают актуальный статус ведомости заново внутри транзакции (а не из снимка снаружи) —
// чтобы решение принималось по свежему состоянию. Для типов без расценки (worksheetStatus=null) и
// опись-актов — no-op: их комплектность считается по самому наличию DOCUMENT-вложения (actState).

/** PRICED → SIGNED при приложении акта. Никакой другой статус не трогаем (цикл только вперёд). */
export async function markWorksheetSigned(
  tx: Prisma.TransactionClient,
  taskId: string,
  actorId: string,
): Promise<void> {
  const task = await tx.task.findUnique({ where: { id: taskId }, select: { worksheetStatus: true } });
  if (task?.worksheetStatus !== "PRICED") return;
  await tx.task.update({ where: { id: taskId }, data: { worksheetStatus: "SIGNED" } });
  await tx.taskEvent.create({
    data: { taskId, actorId, kind: "worksheet_signed", comment: "Акт приложен — ведомость подписана" },
  });
}

/** Откат SIGNED → PRICED, если удалён последний DOCUMENT-акт (до завершения задачи). */
export async function revertWorksheetSignIfNoDocs(
  tx: Prisma.TransactionClient,
  taskId: string,
  actorId: string,
): Promise<void> {
  const task = await tx.task.findUnique({ where: { id: taskId }, select: { worksheetStatus: true } });
  if (task?.worksheetStatus !== "SIGNED") return;
  const remaining = await tx.attachment.count({ where: { taskId, kind: "DOCUMENT" } });
  if (remaining > 0) return;
  await tx.task.update({ where: { id: taskId }, data: { worksheetStatus: "PRICED" } });
  await tx.taskEvent.create({
    data: { taskId, actorId, kind: "worksheet_unsigned", comment: "Акт удалён — ведомость снова на подписи" },
  });
}

// Очередь «на расценке» для диспетчера: задачи с отправленной, но не расценённой ведомостью.
export function listPricingQueue() {
  return prisma.task.findMany({
    where: { worksheetStatus: "PRICING" },
    include: { type: true, assignee: { select: { id: true, name: true, login: true } } },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
  });
}

function assertAdmin(role: Role): void {
  if (role !== "ADMIN") throw Errors.forbidden();
}
