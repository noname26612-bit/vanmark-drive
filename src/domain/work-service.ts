// Доменный сервис ведомости работ (этап 12, PRD §13). Водитель фиксирует ВЫПОЛНЕННЫЕ работы и
// количество — БЕЗ цен; цену проставляет диспетчер при расценке (этап 13). Изоляция как у задач:
// водитель работает только со своей задачей (canViewTask → чужая отдаёт 404). Правка возможна,
// только пока ведомость в DRAFT; после «Отправить на расценку» (PRICING) — заблокировано.
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { Role, WorksheetStatus } from "@/generated/prisma/enums";
import { canViewTask } from "./authz";
import { isDispatcherRole } from "./task-status";
import { stripMoneyForDriver } from "./task-service";
import { Errors } from "./errors";
import { notifyDispatchers, notifyTaskAssignee } from "@/lib/push";

export type Actor = { id: string; role: Role };

function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ───────────────────────────── Разделы справочника (группы) ─────────────────────────────

export function listWorkCategories() {
  return prisma.workCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export type WorkCategoryInput = { name: string; sortOrder?: number; isActive?: boolean };

export async function createWorkCategory(input: Partial<WorkCategoryInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const name = clean(input.name);
  if (!name) throw Errors.validation("Название раздела не может быть пустым");
  if (await prisma.workCategory.findUnique({ where: { name } })) {
    throw Errors.validation("Раздел с таким названием уже есть");
  }
  return prisma.workCategory.create({
    data: { name, sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true },
  });
}

export async function updateWorkCategory(id: string, input: Partial<WorkCategoryInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const existing = await prisma.workCategory.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound();
  const data: { name?: string; sortOrder?: number; isActive?: boolean } = {};
  if (input.name !== undefined) {
    const name = clean(input.name);
    if (!name) throw Errors.validation("Название раздела не может быть пустым");
    if (name !== existing.name && (await prisma.workCategory.findUnique({ where: { name } }))) {
      throw Errors.validation("Раздел с таким названием уже есть");
    }
    data.name = name;
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return prisma.workCategory.update({ where: { id }, data });
}

// ───────────────────────────── Справочник работ ─────────────────────────────

// Порядок: по разделу (sortOrder раздела), затем позиции внутри. Позиции без раздела — в конце.
const catalogOrder = [
  { category: { sortOrder: "asc" } },
  { sortOrder: "asc" },
  { name: "asc" },
] satisfies Prisma.WorkCatalogItemOrderByWithRelationInput[];

// Справочник для ВОДИТЕЛЯ: id, name и название раздела (для группировки). Цену-подсказку
// (defaultPrice) водителю НЕ отдаём — PRD §13: водитель не формирует и не видит цены до расценки.
export async function listWorkCatalog() {
  const rows = await prisma.workCatalogItem.findMany({
    where: { isActive: true },
    orderBy: catalogOrder,
    select: { id: true, name: true, categoryId: true, category: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
  }));
}

// Полный справочник для АДМИНА (включая defaultPrice, раздел и скрытые позиции).
export async function listAllWorkCatalog() {
  const rows = await prisma.workCatalogItem.findMany({
    orderBy: catalogOrder,
    include: { category: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    defaultPrice: r.defaultPrice,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  }));
}

export type WorkCatalogInput = {
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  defaultPrice?: number | null; // цена-подсказка ₽/ед (этап «справочник»): null — без подсказки
  categoryId?: string | null; // раздел справочника; null — без раздела
};

// Нормализует цену-подсказку: null оставляем, число — целое ≥0.
function cleanPrice(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.max(0, Math.trunc(v));
}

// Проверяет, что раздел существует (иначе FK-ошибка); null — без раздела.
async function resolveCategoryId(categoryId: string | null | undefined): Promise<string | null> {
  if (!categoryId) return null;
  const cat = await prisma.workCategory.findUnique({ where: { id: categoryId } });
  if (!cat) throw Errors.validation("Раздел не найден");
  return cat.id;
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
      categoryId: await resolveCategoryId(input.categoryId),
    },
  });
}

export async function updateWorkCatalogItem(id: string, input: Partial<WorkCatalogInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const existing = await prisma.workCatalogItem.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound();
  const data: {
    name?: string;
    isActive?: boolean;
    sortOrder?: number;
    defaultPrice?: number | null;
    categoryId?: string | null;
  } = {};
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
  if (input.categoryId !== undefined) data.categoryId = await resolveCategoryId(input.categoryId);
  return prisma.workCatalogItem.update({ where: { id }, data });
}

// ───────────────────────────── Ведомость задачи ─────────────────────────────

// Загружает задачу с проверкой доступа (изоляция: чужая → 404) и флага requiresPricing.
// Ведомость — зона ОТВЕТСТВЕННОГО (PRD §4, 20.07.2026): напарник видит задачу через canViewTask,
// но заполнять/отправлять ведомость не может — для роли DRIVER требуем assigneeId === actor.id
// (без этого гейта расширение canViewTask на напарника открыло бы ему DRAFT-мутации).
async function loadTaskForWorksheet(taskId: string, actor: Actor) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { type: { select: { requiresPricing: true } } },
  });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound();
  if (actor.role === "DRIVER" && task.assigneeId !== actor.id) throw Errors.forbidden();
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
  // Ведомость сабмитит водитель — деньги компании (carrierCost) в ответ не отдаём (02.07, этап 3).
  return stripMoneyForDriver(result);
}

export type PricingInput = { items: { id: string; price: number }[]; reason?: string | null };

// Диспетчер проставляет цены по позициям и подтверждает расценку (PRICING→PRICED). Только диспетчер/админ.
// Исправление цены ПОСЛЕ подписания акта (SIGNED) разрешено, но только с обязательной причиной
// (preflight-аудит B2, решение Артёма): статус остаётся SIGNED, правка фиксируется отдельным событием.
export async function priceWorksheet(taskId: string, input: PricingInput, actor: Actor) {
  if (!isDispatcherRole(actor.role)) throw Errors.forbidden();
  const task = await loadTaskForWorksheet(taskId, actor);
  if (!task.type.requiresPricing) throw Errors.validation("Для этого типа задачи расценка не нужна");
  const status = task.worksheetStatus;
  if (status !== "PRICING" && status !== "PRICED" && status !== "SIGNED") {
    throw Errors.validation("Ведомость ещё не отправлена на расценку");
  }
  // После подписания акта цену меняем только с причиной (бумажный акт уже подписан клиентом).
  const reason = clean(input.reason);
  const isReprice = status === "SIGNED";
  if (isReprice && !reason) throw Errors.reasonRequired();

  // Применяем цены только к позициям этой задачи (защита от чужих id в теле запроса).
  const existing = await prisma.workItem.findMany({ where: { taskId }, select: { id: true } });
  const ids = new Set(existing.map((i) => i.id));
  const updates = input.items.filter((u) => ids.has(u.id));

  const result = await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.workItem.update({ where: { id: u.id }, data: { price: Math.max(0, Math.trunc(u.price)) } });
    }
    // SIGNED остаётся SIGNED (акт приложен); первичная расценка PRICING/PRICED → PRICED.
    const nextStatus = isReprice ? "SIGNED" : "PRICED";
    const updated = await tx.task.update({ where: { id: taskId }, data: { worksheetStatus: nextStatus } });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: isReprice ? "worksheet_repriced" : "worksheet_priced",
        comment: isReprice ? `Цена исправлена после подписания акта: ${reason}` : "Ведомость расценена",
      },
    });
    return updated;
  });
  // Пуш водителю: цены готовы / исправлены (этап 13).
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
