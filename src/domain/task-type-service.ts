// Справочник типов задач. Чтение активных — диспетчеру (для формы создания);
// управление — только админ (ARCHITECTURE §7: /api/admin/task-types — А).
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";
import { Errors } from "./errors";

export function listActiveTaskTypes() {
  return prisma.taskType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export function listAllTaskTypes() {
  return prisma.taskType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export type TaskTypeInput = {
  name: string;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  onSiteMinutes?: number; // норма работы на объекте, мин (Фаза 2, PRD §14.2)
};

export async function createTaskType(input: Partial<TaskTypeInput>, actor: { role: Role }) {
  assertAdmin(actor.role);
  const name = input.name?.trim();
  if (!name) throw Errors.validation("Название типа не может быть пустым");
  const exists = await prisma.taskType.findUnique({ where: { name } });
  if (exists) throw Errors.validation("Тип с таким названием уже есть");
  return prisma.taskType.create({
    data: {
      name,
      icon: input.icon?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateTaskType(
  id: string,
  input: Partial<TaskTypeInput>,
  actor: { role: Role },
) {
  assertAdmin(actor.role);
  const existing = await prisma.taskType.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound();

  const data: {
    name?: string;
    icon?: string | null;
    sortOrder?: number;
    isActive?: boolean;
    onSiteMinutes?: number;
  } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw Errors.validation("Название типа не может быть пустым");
    if (name !== existing.name) {
      const clash = await prisma.taskType.findUnique({ where: { name } });
      if (clash) throw Errors.validation("Тип с таким названием уже есть");
    }
    data.name = name;
  }
  if (input.icon !== undefined) data.icon = input.icon?.trim() || null;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.onSiteMinutes !== undefined) {
    const m = Math.trunc(input.onSiteMinutes);
    if (!Number.isFinite(m) || m < 0) throw Errors.validation("Норма времени должна быть числом ≥ 0");
    data.onSiteMinutes = m;
  }

  return prisma.taskType.update({ where: { id }, data });
}

function assertAdmin(role: Role): void {
  if (role !== "ADMIN") throw Errors.forbidden();
}
