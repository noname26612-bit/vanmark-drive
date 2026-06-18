// Формы данных задачи, как они приходят клиенту по JSON (даты — строки ISO).
// Держим отдельно от Prisma-типов, чтобы не тащить серверный клиент в браузерный бандл.
import type { AttachmentKind, PassStatus, PaymentType, TaskStatus, WorksheetStatus } from "@/generated/prisma/enums";

export type TaskTypeDTO = {
  id: string;
  name: string;
  icon: string | null;
  requiresSignedDoc: boolean; // тип с актом: дефолт требования акта для новых задач (PRD §3)
  requiresPricing: boolean; // нужна ли ведомость работ + расценка (этап 12, PRD §13)
};

export type TaskTypeFullDTO = TaskTypeDTO & { sortOrder: number; isActive: boolean };

export type AssigneeDTO = { id: string; name: string; login: string } | null;

export type DriverDTO = { id: string; name: string; canLogin: boolean };

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
  requiresSignedDoc: boolean; // требование акта на уровне задачи (снимок из типа, override галочкой)
  actWaivedNote: string | null; // причина снятия требования акта (если снят диспетчером)
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

export type WorkCatalogItemDTO = { id: string; name: string };

export type WorkCatalogFullDTO = WorkCatalogItemDTO & { isActive: boolean; sortOrder: number };

export type WorkItemDTO = {
  id: string;
  catalogItemId: string | null;
  name: string;
  quantity: number;
  sortOrder: number;
  createdById: string;
  createdAt: string;
};

export type TaskDetailDTO = TaskDTO & {
  createdBy: { id: string; name: string };
  events: TaskEventDTO[];
  attachments: AttachmentDTO[];
  workItems: WorkItemDTO[];
};
