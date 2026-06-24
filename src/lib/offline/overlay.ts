// Оверлей очереди на отображаемые данные (чистые функции — юнит-тестируемо). Пока действие не
// долетело до сервера, UI должен показывать его эффект оптимистично: статус задачи отражает
// последний поставленный переход, а наличие неотправленных действий помечается бейджем.
//
// Сознательно покрываем только СТАТУС задачи (главное действие водителя — «В работу»/«Завершить»).
// Комментарии и позиции ведомости после досылки подтянутся ревалидацией SWR; их пер-элементный
// оверлей не делаем, чтобы не плодить сложность (PRD: 3 пользователя, лёгкие сценарии).
import type { TaskStatus } from "@/generated/prisma/enums";
import type { QueuedAction } from "./types";

type WithToStatus = { toStatus?: unknown };

/** Последний поставленный в очередь переход статуса для задачи перекрывает серверный статус. */
export function overlayStatus(serverStatus: TaskStatus, actions: QueuedAction[]): TaskStatus {
  let status = serverStatus;
  for (const a of actions) {
    if (a.kind !== "transition") continue;
    const to = (a.bodyJson as WithToStatus | undefined)?.toStatus;
    if (typeof to === "string") status = to as TaskStatus;
  }
  return status;
}

/** Есть ли по задаче неотправленные (pending/syncing) действия — для бейджа «ждёт отправки». */
export function hasPending(actions: QueuedAction[]): boolean {
  return actions.some((a) => a.status === "pending" || a.status === "syncing");
}

/** Есть ли по задаче конфликт (действие отклонено сервером при досылке) — для баннера водителю. */
export function hasConflict(actions: QueuedAction[]): boolean {
  return actions.some((a) => a.status === "conflict");
}
