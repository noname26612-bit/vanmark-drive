// Права доступа к задачам (ARCHITECTURE §6). Личность — только из сессии (см. src/lib/session.ts).
// Кто «штаб» по заявкам — единственный источник: isTaskManagerRole (src/domain/task-access.ts).
// С 11.08.2026 это ADMIN | DISPATCHER | SERVICE_MANAGER; смены/KPI/деньги — отдельный список.
// Жёсткое правило (CLAUDE.md №1): водитель видит/меняет только задачи, где assigneeId == его id.
// Напарник (20.07.2026, PRD §4): coDriverId ВИДИТ задачу (фото/комментарии — через canViewTask),
// но исполнителем НЕ является — isAssignee остаётся строго по assigneeId, поэтому статусная
// матрица и ведомость для напарника закрыты без единой правки матрицы.
import type { Role } from "@/generated/prisma/enums";
import { isTaskManagerRole } from "./task-access";

export type Viewer = { id: string; role: Role };
export type OwnedTask = { assigneeId: string | null; coDriverId: string | null };

/** Видит ли пользователь задачу: кто ведёт заявки — любую; водитель — свою или парную (напарник). */
export function canViewTask(user: Viewer, task: OwnedTask): boolean {
  if (isTaskManagerRole(user.role)) return true;
  if (task.assigneeId !== null && task.assigneeId === user.id) return true;
  return task.coDriverId !== null && task.coDriverId === user.id;
}

/** Является ли пользователь назначенным ОТВЕТСТВЕННЫМ исполнителем задачи (напарник — нет). */
export function isAssignee(user: Viewer, task: Pick<OwnedTask, "assigneeId">): boolean {
  return task.assigneeId !== null && task.assigneeId === user.id;
}
