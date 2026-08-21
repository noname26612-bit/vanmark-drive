// Формы ответов модуля «Станки» — общие типы для сервера и клиента (как idle-note-dto/task-dto).
// Даты отдаются строками: календарные — «YYYY-MM-DD», моменты — ISO.
import type {
  EquipmentFamily,
  EquipmentKind,
  MachineCategory,
  MachineStatus,
  TaskMachineDirection,
  TaskStatus,
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
  clientNumber: number | null;
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
  clientNumber: number | null;
  model: string;
  qty: number;
};

/** Карточка в списке: всё, что нужно для строки и для клиентского поиска. */
export type MachineListItem = {
  id: string;
  number: number;
  /** «77-N» у своего железа; у клиентского пусто — там свой номер (см. clientNumber). */
  ourNumber: number | null;
  /** «К-N» у клиентского железа; у своего пусто. Заполнено не больше одного номерного поля. */
  clientNumber: number | null;
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
  /** Категории — список: наш станок бывает и на продажу, и арендным (20.08.2026). */
  categories: MachineCategory[];
  status: MachineStatus;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  /** Цена в рублях, целыми. */
  price: number | null;
  contactName: string | null;
  invoice1C: string | null;
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

/** Заявка, по которой везли станок — блок «Заявки» в карточке (21.08.2026, PRD §16.1). */
export type MachineTaskLinkView = {
  taskId: string;
  taskNumber: number;
  title: string;
  typeName: string;
  status: TaskStatus;
  scheduledDate: string | null; // YYYY-MM-DD
  archived: boolean; // заявка убрана в архив — показываем пометкой, ссылку не прячем
  direction: TaskMachineDirection;
  appliedAt: string | null; // ISO — автоматика по этой связи уже отработала
  createdAt: string; // ISO — когда привязали
};

export type MachineDetail = MachineListItem & {
  voidReason: string | null;
  createdAt: string; // ISO
  createdByName: string | null;
  attachments: MachineAttachmentView[];
  events: MachineEventView[];
  /** Заявки, по которым станок везли; свежие сверху. Пусто — станок к заявкам не привязывали. */
  tasks: MachineTaskLinkView[];
};

/**
 * Строка пикера станков в форме заявки (21.08.2026). Нарочно компактная: пикер грузится целиком
 * и фильтруется на клиенте, а длинные тексты карточки там не нужны. Цены здесь нет — пикером
 * пользуется тот же экран, что уходит в телефон, а деньги водителям не показываются.
 */
export type MachinePickerItem = {
  id: string;
  ourNumber: number | null;
  clientNumber: number | null;
  family: EquipmentFamily;
  kind: EquipmentKind;
  model: string;
  configuration: string | null;
  status: MachineStatus;
  categories: MachineCategory[];
  invoice1C: string | null;
  /** Обязательные отметки (диагностика/сверка) не проставлены — янтарная точка. Ничего не блокирует. */
  marksUnset: boolean;
};

export type MachineListResult = {
  machines: MachineListItem[];
  summary: MachineSummary;
  /** Есть ли ещё записи за пределами выданной страницы (архив грузится порциями). */
  hasMore: boolean;
  total: number; // сколько записей подошло под фильтр (до пагинации)
};
