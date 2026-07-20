// Правила пары «ответственный + напарник» (20.07.2026, PRD §4). Чистые функции без Prisma —
// покрываются юнит-тестами, вызываются из task-service при создании/правке/переназначении.
//
// Инварианты пары:
//   1) напарник существует только при назначенном ответственном (coDriverId != null => assigneeId != null);
//   2) напарник != ответственный;
//   3) статусы/деньги/акты/KPI — на ответственном (см. authz.isAssignee — матрица не менялась).

export type CoDriverResolution = {
  coDriverId: string | null;
  // Что произошло с парой — для события TaskEvent kind:"assist" (null — пара не менялась).
  event: "swap" | "removed" | null;
};

/**
 * Что происходит с напарником при смене ОТВЕТСТВЕННОГО (assign/plan/dnd):
 *   - новый ответственный == текущий напарник → SWAP: пара сохраняется, роли меняются
 *     (перетаскивание карточки в колонку напарника читается как «теперь ведёт он»);
 *   - снятие назначения (newAssigneeId = null) → напарник снимается (пара без ответственного запрещена);
 *   - назначение третьего водителя → напарник снимается (пара собиралась под конкретного ответственного);
 *   - тот же ответственный → пара не меняется.
 */
export function resolveCoDriverOnAssign(
  current: { assigneeId: string | null; coDriverId: string | null },
  newAssigneeId: string | null,
): CoDriverResolution {
  const { assigneeId, coDriverId } = current;
  if (coDriverId === null) return { coDriverId: null, event: null };
  if (newAssigneeId === assigneeId) return { coDriverId, event: null };
  if (newAssigneeId === coDriverId && assigneeId !== null) {
    return { coDriverId: assigneeId, event: "swap" };
  }
  return { coDriverId: null, event: "removed" };
}

/**
 * Валидация напарника при создании/правке задачи (значение уже проверено на «активный DRIVER»
 * в task-service через assertAssignableDriver). Возвращает нормализованное значение или бросает.
 */
export function validateCoDriver(
  coDriverId: string | null,
  assigneeId: string | null,
): string | null {
  if (coDriverId === null) return null;
  if (assigneeId === null) {
    throw new CoDriverRuleError("Сначала назначьте ответственного водителя");
  }
  if (coDriverId === assigneeId) {
    throw new CoDriverRuleError("Напарник должен отличаться от ответственного");
  }
  return coDriverId;
}

/** Ошибка правил пары — task-service заворачивает её в Errors.validation (единый формат API). */
export class CoDriverRuleError extends Error {}
