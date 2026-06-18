// Доменный сервис ведомости работ (этап 12, PRD §13). Водитель фиксирует ВЫПОЛНЕННЫЕ работы и
// количество — БЕЗ цен; цену проставляет диспетчер при расценке (этап 13). Изоляция как у задач:
// водитель работает только со своей задачей (canViewTask → чужая отдаёт 404). Правка возможна,
// только пока ведомость в DRAFT; после «Отправить на расценку» (PRICING) — заблокировано.
import { prisma } from "@/lib/prisma";
import type { Role, WorksheetStatus } from "@/generated/prisma/enums";
import { canViewTask } from "./authz";
import { Errors } from "./errors";

export type Actor = { id: string; role: Role };

function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ───────────────────────────── Справочник работ ─────────────────────────────

export function listWorkCatalog() {
  return prisma.workCatalogItem.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export function listAllWorkCatalog() {
  return prisma.workCatalogItem.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export type WorkCatalogInput = { name: string; isActive?: boolean; sortOrder?: number };

export async function createWorkCatalogItem(input: Partial<WorkCatalogInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const name = clean(input.name);
  if (!name) throw Errors.validation("Название работы не может быть пустым");
  if (await prisma.workCatalogItem.findUnique({ where: { name } })) {
    throw Errors.validation("Работа с таким названием уже есть");
  }
  return prisma.workCatalogItem.create({
    data: { name, sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true },
  });
}

export async function updateWorkCatalogItem(id: string, input: Partial<WorkCatalogInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const existing = await prisma.workCatalogItem.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound();
  const data: { name?: string; isActive?: boolean; sortOrder?: number } = {};
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

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data: { worksheetStatus: "PRICING" } });
    await tx.taskEvent.create({
      data: { taskId, actorId: actor.id, kind: "worksheet_submitted", comment: "Ведомость отправлена на расценку" },
    });
    return updated;
  });
}

function assertAdmin(role: Role): void {
  if (role !== "ADMIN") throw Errors.forbidden();
}
