// Формы данных задачи, как они приходят клиенту по JSON (даты — строки ISO).
// Держим отдельно от Prisma-типов, чтобы не тащить серверный клиент в браузерный бандл.
import type { AttachmentKind, PassStatus, PaymentType, TaskStatus } from "@/generated/prisma/enums";

export type TaskTypeDTO = {
  id: string;
  name: string;
  icon: string | null;
  requiresPhoto: boolean;
  requiresSignedDoc: boolean; // ремонтно-арендный тип: ожидается подписанный акт (Фаза 1.5)
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

export type TaskDetailDTO = TaskDTO & {
  createdBy: { id: string; name: string };
  events: TaskEventDTO[];
  attachments: AttachmentDTO[];
};
