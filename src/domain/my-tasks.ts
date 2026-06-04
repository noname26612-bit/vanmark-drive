// Список задач водителя — чистый билдер Prisma-where (ARCHITECTURE §6, CLAUDE.md правило 1).
// Вынесен отдельным модулем без рантайма Prisma, чтобы покрыть юнит-тестом главный инвариант:
// assigneeId ВСЕГДА прибит к id водителя из сессии — нет пути показать чужие задачи.
// Тип-импорты стираются компилятором, поэтому модуль не тянет prisma-клиент и DATABASE_URL.
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";

// Две вкладки экрана водителя (PRD §8): «Сегодня» и «Ближайшие» (завтра+).
export type MyTasksScope = "today" | "upcoming";

// Завершённые статусы — их не тащим в просрочку и в «Ближайшие».
const TERMINAL: TaskStatus[] = ["DONE", "CANCELLED"];

/**
 * Where для списка задач водителя. `assigneeId` пинится к сессии всегда.
 *
 * scope="today" (решение Артёма 04.06.2026 — вариант «свернуть в Сегодня»):
 *   - задачи на сегодня (любой статус: видно и выполненные за день);
 *   - просроченные незавершённые (дата < сегодня) — чтобы не потерялись;
 *   - без даты незавершённые — у водителя нет экрана «все задачи», иначе пропадут из вида.
 * scope="upcoming": задачи на будущее (дата > сегодня), кроме отменённых.
 */
export function myTasksWhere(
  assigneeId: string,
  today: Date,
  scope: MyTasksScope,
): Prisma.TaskWhereInput {
  if (scope === "upcoming") {
    return {
      assigneeId,
      scheduledDate: { gt: today },
      status: { not: "CANCELLED" },
    };
  }
  return {
    assigneeId,
    OR: [
      { scheduledDate: today },
      { scheduledDate: { lt: today }, status: { notIn: TERMINAL } },
      { scheduledDate: null, status: { notIn: TERMINAL } },
    ],
  };
}
