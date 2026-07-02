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

// ——— Смена (O7): офлайн-оверлей блока смены ———

/** Смена, как её видит клиент (подмножество ShiftView, достаточное для блока смены). */
export type ShiftLike = {
  status: "REQUESTED" | "OPEN" | "CLOSED";
  openedAt: string;
  confirmedAt: string | null;
  closedAt: string | null;
};

export type ShiftOverlay = ShiftLike & {
  /** Есть неотправленные действия смены — бейдж «не отправлено, уйдёт при связи». */
  pendingLocal: boolean;
};

/**
 * Нормализация смены из кэша: наутро офлайн стабильный ключ может отдать ВЧЕРАШНЮЮ смену. Закрытая
 * смена другого дня — это «сегодня смена не открыта» (null: водителю кнопка «Открыть смену», оверлей
 * офлайн-открытия применится поверх). Незакрытую возвращаем как есть — её реально можно закрыть или
 * продолжить (гейт «В работу» на сервере тоже принимает незакрытую смену любой даты).
 */
export function currentShift<T extends ShiftLike & { date?: string }>(server: T | null, today: string): T | null {
  if (!server) return null;
  if (server.date && server.date !== today && server.status === "CLOSED") return null;
  return server;
}

/**
 * Накладывает неотправленные (pending/syncing) действия смены на серверное/кэшированное состояние —
 * блок смены офлайн сразу показывает эффект нажатия: открыл → «ждёт подтверждения» (с временем
 * нажатия), закрыл → «закрыта», возобновил → рабочий статус. Конфликтные действия не применяем
 * (их разберёт водитель), reopen подтверждённой смены возвращает OPEN — как reopenedStatus на сервере.
 */
export function overlayShift(server: ShiftLike | null, actions: QueuedAction[]): ShiftOverlay | null {
  let cur: ShiftLike | null = server;
  let pendingLocal = false;
  for (const a of actions) {
    if (a.kind !== "shift") continue;
    if (a.status !== "pending" && a.status !== "syncing") continue;
    pendingLocal = true;
    const op = (a.bodyJson as { op?: unknown } | undefined)?.op;
    if (op === "open" && !cur) {
      cur = { status: "REQUESTED", openedAt: a.occurredAt, confirmedAt: null, closedAt: null };
    } else if (op === "close" && cur && cur.status !== "CLOSED") {
      cur = { ...cur, status: "CLOSED", closedAt: a.occurredAt };
    } else if (op === "reopen" && cur && cur.status === "CLOSED") {
      cur = { ...cur, status: cur.confirmedAt ? "OPEN" : "REQUESTED", closedAt: null };
    }
  }
  return cur ? { ...cur, pendingLocal } : null;
}

/** Есть ли по задаче конфликт (действие отклонено сервером при досылке) — для баннера водителю. */
export function hasConflict(actions: QueuedAction[]): boolean {
  return actions.some((a) => a.status === "conflict");
}
