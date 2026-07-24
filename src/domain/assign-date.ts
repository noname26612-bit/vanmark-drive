// Чистая доменная логика авто-даты при назначении (п.1). Без prisma/IO — юнит-тестируема,
// как myTasksWhere в my-tasks.ts. Используется в task-service.assignTask.

/**
 * Дата, которую надо проставить задаче при назначении водителя.
 * Назначение задачи БЕЗ даты ИЛИ с ПРОСРОЧЕННОЙ датой → сегодня. Без даты — уходит из пула «Без даты»
 * в работу на сегодня; просроченная (дата в прошлом) — при назначении/перетаскивании из «Требуют
 * внимания» на водителя встаёт в сегодняшнюю работу, а не остаётся висеть в прошлом (доработка 24.07.2026).
 * Задача с сегодняшней/будущей датой не трогается; снятие назначения (assigneeId == null) — тоже `null`.
 */
export function resolveAssignedDate(
  currentDate: Date | null,
  assigneeId: string | null,
  today: Date | null,
): Date | null {
  if (!assigneeId || today === null) return null;
  if (currentDate === null) return today; // без даты → сегодня
  if (currentDate.getTime() < today.getTime()) return today; // просрочена → переносим на сегодня
  return null; // сегодня/будущее — не трогаем
}
