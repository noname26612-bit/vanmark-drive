// Типы офлайн-очереди действий водителя. Каждое действие, выполненное без сети, кладётся в очередь
// (IndexedDB store "queue") и досылается при возврате связи. id = Idempotency-Key (uuid) — тот же
// ключ уходит в заголовок при досылке, чтобы повтор не задвоил эффект (см. src/domain/idempotency.ts).

// Виды действий совпадают с kind на сервере (route handlers withIdempotency).
export type QueuedActionKind =
  | "transition"
  | "comment"
  | "attachment"
  | "attachment-delete"
  | "work-item-add"
  | "work-item-update"
  | "work-item-delete"
  | "worksheet-submit"
  | "shift"; // открыть/закрыть/возобновить смену (O7): bodyJson = { op }, taskId = null

export type QueuedActionStatus = "pending" | "syncing" | "conflict";

export type QueuedAction = {
  id: string; // uuid = Idempotency-Key
  seq: number; // порядок постановки (Date.now()) — досылаем FIFO
  kind: QueuedActionKind;
  method: "POST" | "PATCH" | "DELETE";
  url: string; // относительный путь API (/api/tasks/:id/transition ...)
  occurredAt: string; // ISO — момент действия на телефоне (уходит в заголовок X-Occurred-At)
  taskId: string | null; // к какой задаче относится — для оверлея и инвалидации кэша
  bodyJson?: unknown; // тело JSON-мутаций (transition/comment/work-item/...)
  blobId?: string; // ключ файла в STORE_BLOBS — для multipart (фото офлайн)
  blobMeta?: { name: string; type: string; kind: "PHOTO" | "DOCUMENT" };
  status: QueuedActionStatus;
  attempts: number;
  lastError?: { code: string; message: string }; // последняя ошибка досылки (для conflict — доменная 4xx)
  createdAt: string; // ISO
};
