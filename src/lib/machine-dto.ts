// Формы ответов модуля «Станки» — общие типы для сервера и клиента (как idle-note-dto/task-dto).
// Даты отдаются строками: календарные — «YYYY-MM-DD», моменты — ISO.
import type {
  EquipmentFamily,
  EquipmentKind,
  MachineCategory,
  MachineStatus,
} from "@/generated/prisma/enums";
import type { MachineSummary } from "@/domain/machine-flags";

export type { MachineSummary };

/** Одна запись «было→стало» в журнале правки. Значения уже человекочитаемые. */
export type MachineChange = {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
};

export type MachineEventView = {
  id: string;
  kind: string; // created | status_change | edit | comment | shop_task | photo_added | photo_removed
  actorName: string;
  fromStatus: MachineStatus | null;
  toStatus: MachineStatus | null;
  comment: string | null;
  changes: MachineChange[];
  at: string; // ISO
};

export type MachineAttachmentView = {
  id: string;
  mimeType: string;
  createdAt: string; // ISO
};

/** Часть комплекта в строке списка и в карточке. Одна форма для ножа и для складской позиции. */
export type KitPartView = {
  id: string;
  ourNumber: number | null;
  kind: EquipmentKind;
  model: string;
  status: MachineStatus;
  qty: number; // >1 только у складских позиций
  consumedAt: string | null; // ISO — списано вместе с продажей головного
};

/** Комплект, в котором состоит карточка (для комплектующей — её головной станок). */
export type KitHeadView = {
  id: string;
  ourNumber: number | null;
  model: string;
  qty: number;
};

/** Карточка в списке: всё, что нужно для строки и для клиентского поиска. */
export type MachineListItem = {
  id: string;
  number: number;
  ourNumber: number | null;
  family: EquipmentFamily;
  kind: EquipmentKind;
  /** Всего на складе (складские виды). У штучного оборудования всегда 1. */
  quantity: number;
  /** Свободно из quantity: остаток минус разобранное по комплектам. */
  freeQuantity: number;
  /** Что уедет вместе с этой карточкой (заполнено у головных). */
  kitParts: KitPartView[];
  /** В чьих комплектах числится эта карточка (заполнено у комплектующих). */
  kitHeads: KitHeadView[];
  category: MachineCategory;
  status: MachineStatus;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  serialNumber: string | null;
  orgName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  invoice1C: string | null;
  location: string | null;
  deliveredBy: string | null;
  defectNotes: string | null;
  notes: string | null;
  isUrgent: boolean;
  arrivedAt: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD — срок готовности/выдачи
  diagnosedAt: string | null; // ISO
  lastVerifiedAt: string | null; // ISO
  responsibleId: string | null;
  responsibleName: string | null;
  photoId: string | null; // первое фото — миниатюра в списке
  photoCount: number;
  updatedAt: string; // ISO
};

export type MachineDetail = MachineListItem & {
  voidReason: string | null;
  createdAt: string; // ISO
  createdByName: string | null;
  attachments: MachineAttachmentView[];
  events: MachineEventView[];
};

export type MachineListResult = {
  machines: MachineListItem[];
  summary: MachineSummary;
  /** Уже использованные места на площадке — подсказка (datalist) при вводе. */
  locations: string[];
  /** Есть ли ещё записи за пределами выданной страницы (архив грузится порциями). */
  hasMore: boolean;
  total: number; // сколько записей подошло под фильтр (до пагинации)
};
