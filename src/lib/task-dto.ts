// Формы данных задачи, как они приходят клиенту по JSON (даты — строки ISO).
// Держим отдельно от Prisma-типов, чтобы не тащить серверный клиент в браузерный бандл.
import type { AttachmentKind, PassStatus, PaymentType, TaskStatus, WorksheetStatus } from "@/generated/prisma/enums";

export type TaskTypeDTO = {
  id: string;
  name: string;
  icon: string | null;
  requiresSignedDoc: boolean; // тип с актом: дефолт требования акта для новых задач (PRD §3)
  requiresPricing: boolean; // нужна ли ведомость работ + расценка (этап 12, PRD §13)
  onSiteMinutes: number; // норма работы на объекте, мин (Фаза 2, PRD §14.2)
};

export type TaskTypeFullDTO = TaskTypeDTO & { sortOrder: number; isActive: boolean };

export type AssigneeDTO = { id: string; name: string; login: string } | null;

// onPayroll — есть активный денежный профиль (штатный «на окладе»). Признак «работает каждый день»
// для блока «Смены водителей»: штатных показываем всегда, подменных/внешних — только при смене (Артём 24.06).
// isExternal — наёмный перевозчик (02.07): без смен, в форме заявки доступна стоимость поездки (этап 3).
export type DriverDTO = { id: string; name: string; canLogin: boolean; isExternal: boolean; onPayroll: boolean };

export type TaskDTO = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  equipment: string | null;
  orgName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  address: string;
  addressLink: string | null;
  invoiceNumber: string | null;
  paymentType: PaymentType;
  paymentAmount: number | null;
  paymentNote: string | null;
  scheduledDate: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  timeNote: string | null;
  passStatus: PassStatus;
  priority: boolean;
  // Ёмкость и оценка времени (Фаза 2, PRD §14).
  lat: number | null; // координаты адреса (геокод)
  lng: number | null;
  estimatedMinutes: number | null; // оценка времени, мин (норма типа + дорога); null — не посчитана
  estimateIsManual: boolean; // оценка задана диспетчером вручную (не пересчитывается авто)
  requiresSignedDoc: boolean; // требование акта на уровне задачи (снимок из типа, override галочкой)
  actWaivedNote: string | null; // причина снятия требования акта (если снят диспетчером)
  hasSignedDoc?: boolean; // приложен ли подписанный акт (этап 14): есть DOCUMENT-вложение. В списках
  // выставляется сервером; в карточке (TaskDetailDTO) считается из attachments на клиенте.
  worksheetStatus: WorksheetStatus | null; // ведомость работ (этап 12): null — не нужна для типа
  status: TaskStatus;
  assigneeId: string | null;
  assignee: AssigneeDTO;
  createdById: string;
  cancelReason: string | null;
  holdReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  type: TaskTypeDTO;
};

// Блок «Требуют внимания» доски (Этап 6): просрочки + незаказанные пропуска на завтра.
export type AttentionDTO = {
  overdue: TaskDTO[];
  tomorrowPasses: TaskDTO[];
};

export type TaskEventDTO = {
  id: string;
  kind: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  comment: string | null;
  lat: number | null;
  lng: number | null;
  at: string;
  actor: { id: string; name: string };
};

export type AttachmentDTO = {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  createdById: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
};

// Раздел справочника (группа услуг/товаров) — управляет админ.
export type WorkCategoryDTO = { id: string; name: string; sortOrder: number; isActive: boolean };

// Для водителя: без цены (PRD §13); с разделом — для группировки в выборе.
export type WorkCatalogItemDTO = {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
};

export type WorkCatalogFullDTO = WorkCatalogItemDTO & {
  isActive: boolean;
  sortOrder: number;
  defaultPrice: number | null; // цена-подсказка ₽/ед — только для админа/диспетчера
};

export type WorkItemDTO = {
  id: string;
  catalogItemId: string | null;
  name: string;
  quantity: number;
  price: number | null; // цена за единицу, ₽ (этап 13): null пока не расценено
  defaultPrice?: number | null; // цена-подсказка из справочника (этап «справочник»): только диспетчеру
  sortOrder: number;
  createdById: string;
  createdAt: string;
};

export type TaskDetailDTO = TaskDTO & {
  createdBy: { id: string; name: string };
  events: TaskEventDTO[];
  attachments: AttachmentDTO[];
  workItems: WorkItemDTO[];
  // Факт оплаты при ON_SITE-завершении (№8): true получено / false не получено / null не относится.
  paymentReceived: boolean | null;
  paymentMissedReason: string | null;
  // Причина водителя при завершении актовой задачи без акта (акты до 20:00, 02.07); null — не выбиралась.
  actMissedReason: string | null;
};
