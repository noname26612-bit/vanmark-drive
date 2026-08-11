// Блок «Требуют внимания» на доске диспетчера (Этап 6, PRD §6/§8, ui-guidelines).
// Чистые билдеры Prisma-where — без рантайма Prisma (только type-импорты), чтобы покрыть
// юнит-тестом главные инварианты: что именно попадает в «внимание» и что НЕ попадает.
// Состав (ui-guidelines: «просрочки + пропуска на завтра»):
//   1) overdue        — незавершённые задачи с прошедшей датой (потерялись, дата прошла);
//   2) tomorrowPasses — задачи на завтра с пропуском «нужен, не заказан» (заказать сегодня).
// Детектор «зависла в статусе дольше X часов» (PRD §7) в MVP выключен — здесь его нет.
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";

// Завершённые статусы — их во «внимание» не тащим (задача закрыта).
const TERMINAL: TaskStatus[] = ["DONE", "CANCELLED"];

/** Просроченные: дата строго меньше сегодня и задача ещё не завершена (архивные — не в счёт). */
export function overdueWhere(today: Date): Prisma.TaskWhereInput {
  return {
    scheduledDate: { lt: today },
    status: { notIn: TERMINAL },
    archivedAt: null,
  };
}

/** На завтра нужен, но не заказан пропуск (PRD §6) — и задача ещё не завершена. */
export function tomorrowPassWhere(tomorrow: Date): Prisma.TaskWhereInput {
  return {
    scheduledDate: tomorrow,
    passStatus: "NEEDED",
    status: { notIn: TERMINAL },
    archivedAt: null,
  };
}
