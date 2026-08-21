// Справочник типов задач. Чтение активных — диспетчеру (для формы создания);
// управление — только админ (ARCHITECTURE §7: /api/admin/task-types — А).
import { prisma } from "@/lib/prisma";
import type { MachineFlow, Role, TaskKind } from "@/generated/prisma/enums";
import { Errors } from "./errors";

/**
 * Активные типы контура. По умолчанию — заявки водителям: их справочник и есть «типы задач» во всех
 * формах доставок. Служебный тип задач сотрудникам (kind=STAFF) в этих списках не показывается —
 * его подставляет сервер при создании (см. createTask).
 */
export function listActiveTaskTypes(kind: TaskKind = "DELIVERY") {
  return prisma.taskType.findMany({
    where: { isActive: true, kind },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * Служебный тип задач сотрудникам. Классификации у них нет (решение Артёма 15.08.2026 — «пока
 * просто чтобы можно было создавать»), но Task.typeId обязателен, поэтому один тип всегда должен
 * быть заведён: его ставит сид (seed.ts / seed-roster.ts).
 */
export async function requireStaffTaskType(): Promise<{ id: string }> {
  const type = await prisma.taskType.findFirst({
    where: { kind: "STAFF", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (!type) {
    throw Errors.validation(
      "Тип задач сотрудникам не заведён — выполните db:seed:roster (или включите тип в /admin/task-types)",
    );
  }
  return type;
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
  // Что делать с привязанным станком при завершении заявки (21.08.2026, PRD §16.1).
  // Дефолт NONE безопасен: связь и журналы есть, состояние карточки система не трогает.
  machineFlow?: MachineFlow;
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
      machineFlow: input.machineFlow ?? "NONE",
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
    machineFlow?: MachineFlow;
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
  if (input.isActive !== undefined) {
    // Служебный тип задач сотрудникам — единственный в своём контуре: отключив его, админ молча
    // сломал бы создание задач цеху и снабжению. Отказываем понятным текстом.
    if (existing.kind === "STAFF" && input.isActive === false) {
      throw Errors.validation(
        "Это служебный тип задач сотрудникам — без него их нельзя создавать. Отключать нельзя",
      );
    }
    data.isActive = input.isActive;
  }
  if (input.onSiteMinutes !== undefined) {
    const m = Math.trunc(input.onSiteMinutes);
    if (!Number.isFinite(m) || m < 0) throw Errors.validation("Норма времени должна быть числом ≥ 0");
    data.onSiteMinutes = m;
  }
  if (input.machineFlow !== undefined) {
    // Задачам сотрудникам станки не привязываются вовсе (stripDeliveryOnlyFields) — правило
    // на служебном типе было бы обещанием, которого система не выполнит.
    if (existing.kind === "STAFF" && input.machineFlow !== "NONE") {
      throw Errors.validation("К задачам сотрудникам станки не привязываются");
    }
    data.machineFlow = input.machineFlow;
  }

  return prisma.taskType.update({ where: { id }, data });
}

function assertAdmin(role: Role): void {
  if (role !== "ADMIN") throw Errors.forbidden();
}
