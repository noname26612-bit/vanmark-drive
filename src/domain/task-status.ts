// ЕДИНСТВЕННЫЙ источник статусной матрицы (ARCHITECTURE §5, CLAUDE.md правило 2).
// Любой переход статуса в системе проходит через checkTransition — в обход нельзя.
// Менять матрицу — только после согласования с Артёмом.
import type { Role, TaskStatus } from "@/generated/prisma/enums";

export type EdgeRule = {
  /** Может ли назначенный водитель сам выполнить переход.
   *  Диспетчер/админ может любой ВАЛИДНЫЙ переход (решение Артёма 04.06.2026:
   *  диспетчер ведёт статусы, в т.ч. за внешнего исполнителя и для исправлений). */
  driver: boolean;
};

// from -> to -> правило. Отсутствие ребра = переход запрещён всем.
const MATRIX: Partial<Record<TaskStatus, Partial<Record<TaskStatus, EdgeRule>>>> = {
  NEW: {
    ASSIGNED: { driver: false },
    ON_HOLD: { driver: false },
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  ASSIGNED: {
    ACCEPTED: { driver: true },
    ON_HOLD: { driver: false },
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  ACCEPTED: {
    EN_ROUTE: { driver: true },
    ON_HOLD: { driver: true }, // В* — только с причиной (см. reasonRequiredFor)
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  EN_ROUTE: {
    ON_SITE: { driver: true },
    ON_HOLD: { driver: true },
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  ON_SITE: {
    DONE: { driver: true }, // фото при DONE проверяется в сервисе (этап 4)
    ON_HOLD: { driver: true },
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  ON_HOLD: {
    ASSIGNED: { driver: false },
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  // RESCHEDULED — транзитный: сервис переносит дату и возвращает задачу в ASSIGNED (PRD §5).
  RESCHEDULED: {
    ASSIGNED: { driver: false },
  },
  DONE: {},
  CANCELLED: {},
};

export function transitionRule(from: TaskStatus, to: TaskStatus): EdgeRule | null {
  return MATRIX[from]?.[to] ?? null;
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitionRule(from, to) !== null;
}

/** Статусы, для которых обязательна причина (пишется в задачу и в журнал). */
export function reasonRequiredFor(to: TaskStatus): boolean {
  return to === "ON_HOLD" || to === "CANCELLED";
}

export function isDispatcherRole(role: Role): boolean {
  return role === "ADMIN" || role === "DISPATCHER";
}

export function isTerminal(status: TaskStatus): boolean {
  const out = MATRIX[status];
  return !out || Object.keys(out).length === 0;
}

export type TransitionActor = { role: Role; isAssignee: boolean };

export type TransitionVerdict =
  | { ok: true; reasonRequired: boolean }
  | { ok: false; code: "INVALID_TRANSITION" | "FORBIDDEN" };

/** Главная проверка: может ли актор выполнить переход from→to. */
export function checkTransition(
  actor: TransitionActor,
  from: TaskStatus,
  to: TaskStatus,
): TransitionVerdict {
  const rule = transitionRule(from, to);
  if (!rule) return { ok: false, code: "INVALID_TRANSITION" };

  // Диспетчер/админ — любой валидный переход.
  if (isDispatcherRole(actor.role)) {
    return { ok: true, reasonRequired: reasonRequiredFor(to) };
  }
  // Водитель — только свои разрешённые рёбра и только по своей задаче.
  if (actor.role === "DRIVER" && actor.isAssignee && rule.driver) {
    return { ok: true, reasonRequired: reasonRequiredFor(to) };
  }
  return { ok: false, code: "FORBIDDEN" };
}
