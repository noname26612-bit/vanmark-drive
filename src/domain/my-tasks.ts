// Список задач водителя — чистый билдер Prisma-where (ARCHITECTURE §6, CLAUDE.md правило 1).
// Вынесен отдельным модулем без рантайма Prisma, чтобы покрыть юнит-тестом главный инвариант:
// владение ВСЕГДА прибито к id водителя из сессии — нет пути показать чужие задачи.
// Напарник (20.07.2026): «свои» = ответственный ИЛИ напарник, поэтому владение — OR из двух
// полей, обёрнутый в верхнеуровневый AND (внутри scope="today" уже есть OR по датам).
// Тип-импорты стираются компилятором, поэтому модуль не тянет prisma-клиент и DATABASE_URL.
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";

// Две вкладки экрана водителя (PRD §8): «Сегодня» и «Ближайшие» (завтра+).
export type MyTasksScope = "today" | "upcoming";

// Завершённые статусы — их не тащим в просрочку и в «Ближайшие».
const TERMINAL: TaskStatus[] = ["DONE", "CANCELLED"];

// Владение задачей: водитель — ответственный или напарник. Единственный путь выборки «моих».
function ownershipWhere(driverId: string): Prisma.TaskWhereInput {
  return { OR: [{ assigneeId: driverId }, { coDriverId: driverId }] };
}

/**
 * Where для списка задач водителя. Владение (assigneeId | coDriverId) пинится к сессии всегда —
 * оно лежит в верхнеуровневом AND, ни одна ветка дат не может «вытащить» чужую задачу.
 *
 * scope="today" (решение Артёма 04.06.2026 — вариант «свернуть в Сегодня»):
 *   - задачи на сегодня (кроме отменённых — 11.08.2026: отменённую водителю показывать незачем,
 *     про отмену ему приходит пуш, а в списке она только сбивает);
 *   - просроченные незавершённые (дата < сегодня) — чтобы не потерялись;
 *   - без даты незавершённые — у водителя нет экрана «все задачи», иначе пропадут из вида.
 * scope="upcoming": задачи на будущее (дата > сегодня), кроме отменённых.
 *
 * Архивные (11.08.2026) не показываются ни в одной вкладке: заявка убрана из работы совсем.
 */
export function myTasksWhere(
  driverId: string,
  today: Date,
  scope: MyTasksScope,
): Prisma.TaskWhereInput {
  if (scope === "upcoming") {
    return {
      AND: [
        ownershipWhere(driverId),
        { archivedAt: null },
        { scheduledDate: { gt: today }, status: { not: "CANCELLED" } },
      ],
    };
  }
  return {
    AND: [
      ownershipWhere(driverId),
      { archivedAt: null },
      { status: { not: "CANCELLED" } },
      {
        OR: [
          { scheduledDate: today },
          { scheduledDate: { lt: today }, status: { notIn: TERMINAL } },
          { scheduledDate: null, status: { notIn: TERMINAL } },
        ],
      },
    ],
  };
}
