// Права доступа к задачам (ARCHITECTURE §6). Личность — только из сессии (см. src/lib/session.ts).
// Жёсткое правило (CLAUDE.md №1): водитель видит/меняет только задачи, где assigneeId == его id.
// Напарник (20.07.2026, PRD §4): coDriverId ВИДИТ задачу (фото/комментарии — через canViewTask),
// но исполнителем НЕ является — isAssignee остаётся строго по assigneeId, поэтому статусная
// матрица и ведомость для напарника закрыты без единой правки матрицы.
import type { Role } from "@/generated/prisma/enums";

export type Viewer = { id: string; role: Role };
export type OwnedTask = { assigneeId: string | null; coDriverId: string | null };

/** Видит ли пользователь задачу: диспетчер/админ — любую; водитель — свою или парную (напарник). */
export function canViewTask(user: Viewer, task: OwnedTask): boolean {
  if (user.role === "ADMIN" || user.role === "DISPATCHER") return true;
  if (task.assigneeId !== null && task.assigneeId === user.id) return true;
  return task.coDriverId !== null && task.coDriverId === user.id;
}

/** Является ли пользователь назначенным ОТВЕТСТВЕННЫМ исполнителем задачи (напарник — нет). */
export function isAssignee(user: Viewer, task: Pick<OwnedTask, "assigneeId">): boolean {
  return task.assigneeId !== null && task.assigneeId === user.id;
}
