// Права доступа к задачам (ARCHITECTURE §6). Личность — только из сессии (см. src/lib/session.ts).
// Жёсткое правило (CLAUDE.md №1): водитель видит/меняет только задачи, где assigneeId == его id.
import type { Role } from "@/generated/prisma/enums";

export type Viewer = { id: string; role: Role };
export type OwnedTask = { assigneeId: string | null };

/** Видит ли пользователь задачу: диспетчер/админ — любую; водитель — только свою. */
export function canViewTask(user: Viewer, task: OwnedTask): boolean {
  if (user.role === "ADMIN" || user.role === "DISPATCHER") return true;
  return task.assigneeId !== null && task.assigneeId === user.id;
}

/** Является ли пользователь назначенным исполнителем задачи. */
export function isAssignee(user: Viewer, task: OwnedTask): boolean {
  return task.assigneeId !== null && task.assigneeId === user.id;
}
