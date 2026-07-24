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
// Переработка механики водителя (этап A): рабочая цепочка схлопнута до IN_PROGRESS «В работе»
// (прежние ACCEPTED→EN_ROUTE→ON_SITE — одно состояние). До взятия (NEW/ASSIGNED) водитель статуса
// не ведёт. Цепочка водителя: ASSIGNED → IN_PROGRESS → DONE; пауза ON_HOLD «На паузе» (причина по
// желанию) освобождает слот и возвращается в работу через IN_PROGRESS. Legacy-статусы рёбер не имеют —
// в них перейти нельзя (они существуют только в истории).
const MATRIX: Partial<Record<TaskStatus, Partial<Record<TaskStatus, EdgeRule>>>> = {
  NEW: {
    ASSIGNED: { driver: false },
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  ASSIGNED: {
    IN_PROGRESS: { driver: true }, // водитель берёт задачу в работу (проверка «одна активная» — в сервисе)
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  IN_PROGRESS: {
    DONE: { driver: true }, // завершение; при оплате «на месте» — подтверждение денег в сервисе (PRD §5)
    ON_HOLD: { driver: true }, // пауза (причина по желанию — см. reasonRequiredFor); освобождает слот
    RESCHEDULED: { driver: false },
    CANCELLED: { driver: false },
  },
  ON_HOLD: {
    IN_PROGRESS: { driver: true }, // водитель возобновляет (при свободном слоте — проверка в сервисе)
    ASSIGNED: { driver: false }, // диспетчер снимает паузу/возвращает в пул
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

/** Статусы, для которых обязательна причина (пишется в задачу и в журнал).
 *  Пауза (ON_HOLD) — причина по желанию (решение Артёма 02.07.2026): водитель ставит паузу
 *  без обязательного комментария. Отмена (CANCELLED) — причина по-прежнему обязательна (история).
 *  Откат/исправление из терминального статуса (from ∈ {DONE, CANCELLED}) диспетчером — тоже требует
 *  причину для аудита (свободная смена статуса, решение Артёма 24.07.2026; кейс №700). */
export function reasonRequiredFor(to: TaskStatus, from?: TaskStatus): boolean {
  if (to === "CANCELLED") return true;
  if (from === "DONE" || from === "CANCELLED") return true;
  return false;
}

export function isDispatcherRole(role: Role): boolean {
  return role === "ADMIN" || role === "DISPATCHER";
}

// Актуальные статусы, которые диспетчер/директор может выставлять ВРУЧНУЮ (свободная смена статуса,
// решение Артёма 24.07.2026: исправление ошибок исполнителя, откат ошибочного «Завершено» — кейс №700).
// Legacy-статусы (ACCEPTED/EN_ROUTE/ON_SITE) и транзитный RESCHEDULED сюда не входят — их вручную не
// ставят. Побочные эффекты отката (снятие completedAt/оплаты/причин) выполняет transitionTask.
export const MANUAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "DONE",
  "CANCELLED",
]);

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

  // Диспетчер/админ ведёт статусы вручную. Помимо «водительских» рёбер матрицы ему разрешена свободная
  // установка любого актуального статуса — в т.ч. выход из DONE/CANCELLED (исправления, откат №700,
  // решение Артёма 24.07.2026). Ограничение: оба статуса «ручные» (не legacy/RESCHEDULED) и переход
  // непустой. Побочные эффекты отката снимает transitionTask; причина обязательна (reasonRequiredFor).
  if (isDispatcherRole(actor.role)) {
    const manual = MANUAL_STATUSES.has(from) && MANUAL_STATUSES.has(to) && from !== to;
    if (rule || manual) return { ok: true, reasonRequired: reasonRequiredFor(to, from) };
    return { ok: false, code: "INVALID_TRANSITION" };
  }

  // Водитель — только свои разрешённые рёбра матрицы и только по своей задаче.
  if (!rule) return { ok: false, code: "INVALID_TRANSITION" };
  if (actor.role === "DRIVER" && actor.isAssignee && rule.driver) {
    return { ok: true, reasonRequired: reasonRequiredFor(to, from) };
  }
  return { ok: false, code: "FORBIDDEN" };
}
