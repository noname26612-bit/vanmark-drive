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
  | "work-item-delete"
  | "worksheet-submit"
  | "shift"; // открыть/закрыть/возобновить смену (O7): bodyJson = { op }, taskId = null
// (клиент правку позиции ведомости в очередь не ставит — kind "work-item-update" убран, O8)

export type QueuedActionStatus = "pending" | "syncing" | "conflict";

export type QueuedAction = {
  id: string; // uuid = Idempotency-Key
  seq: number; // порядок постановки (монотонный nextSeq, см. send.ts) — досылаем FIFO
  kind: QueuedActionKind;
  method: "POST" | "PATCH" | "DELETE";
  url: string; // относительный путь API (/api/tasks/:id/transition ...)
  occurredAt: string; // ISO — момент действия на телефоне (уходит в заголовок X-Occurred-At)
  taskId: string | null; // к какой задаче относится — для оверлея и инвалидации кэша
  bodyJson?: unknown; // тело JSON-мутаций (transition/comment/work-item/...)
  blobId?: string; // ключ файла в STORE_BLOBS — для multipart (фото офлайн)
  blobMeta?: { name: string; type: string; kind: "PHOTO" | "DOCUMENT" };
  status: QueuedActionStatus;
  // Счётчик неудачных попыток досылки. Растёт между тиками ТОЛЬКО на HTTP 500 (необработанная ошибка
  // приложения — сигнатура «ядовитого» действия, см. sync.ts): по достижении порога SERVER_ERROR_LIMIT
  // действие уходит в conflict (SERVER_REJECTED), чтобы одно застрявшее действие не блокировало очередь
  // навсегда (инцидент 06.07). Обрывы связи (status 0) и прочие 5xx (502/503/504/501/505… — инфраструктура/
  // деплой) счётчик НЕ трогают. Для доменного 4xx-конфликта = число попыток до отклонения (обычно 1).
  attempts: number;
  // последняя ошибка досылки (для conflict — доменная 4xx или серверный отказ SERVER_REJECTED после порога)
  lastError?: { code: string; message: string };
  createdAt: string; // ISO
};
