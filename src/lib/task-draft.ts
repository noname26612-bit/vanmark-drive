// Черновик формы создания заявки (доработка №1, 03.07.2026). Форма «Новая задача» закрывается тремя
// путями (клик мимо/Escape/крестик) и раньше молча теряла ввод. Теперь непустая форма при случайном
// закрытии СВОРАЧИВАЕТСЯ в черновик — плашка-чип внизу экрана, по клику форма открывается заново.
// Черновик живёт ТОЛЬКО на клиенте (localStorage): на сервер ничего не уходит до кнопки «Создать»,
// поэтому ни фантомных задач, ни номеров, ни записей в журнал — изоляция и правила проекта не задеты.
import type { PassStatus, PaymentType } from "@/generated/prisma/enums";

// Состояние формы создания/редактирования задачи. Полностью сериализуемо (строки/булевы/enum) —
// кладётся в localStorage целиком без потерь.
export type FormState = {
  typeId: string;
  title: string;
  address: string;
  description: string;
  equipment: string;
  orgName: string;
  contactName: string;
  contactPhone: string;
  addressLink: string;
  invoiceNumber: string;
  paymentType: PaymentType;
  paymentAmount: string;
  paymentNote: string;
  scheduledDate: string;
  timeFrom: string;
  timeTo: string;
  timeNote: string;
  passStatus: PassStatus;
  priority: boolean;
  assigneeId: string;
  coDriverId: string; // напарник (20.07.2026, PRD §4); "" — нет. Старые черновики читаются с дефолтом ""
  requiresAct: boolean; // требование акта (дефолт из типа, диспетчер может снять)
  actWaivedNote: string; // причина снятия требования акта
  carrierCost: string; // стоимость поездки внешнего перевозчика, ₽ (этап 3; видна при внешнем исполнителе)
};

export function emptyForm(typeId: string, date: string, requiresAct: boolean): FormState {
  return {
    typeId,
    title: "",
    address: "",
    description: "",
    equipment: "",
    orgName: "",
    contactName: "",
    contactPhone: "",
    addressLink: "",
    invoiceNumber: "",
    paymentType: "NONE",
    paymentAmount: "",
    paymentNote: "",
    scheduledDate: date,
    timeFrom: "",
    timeTo: "",
    timeNote: "",
    passStatus: "NOT_NEEDED",
    priority: false,
    assigneeId: "",
    coDriverId: "",
    requiresAct,
    actWaivedNote: "",
    carrierCost: "",
  };
}

// «Грязная» форма — есть содержательный пользовательский ввод, который стоит сохранить в черновик.
// Тип и дата заполнены по умолчанию (не считаем их вводом); учитываем текстовые поля и осознанные
// отклонения селектов/флагов от дефолтов. Пустую форму просто закрываем, не засоряя плашку черновиками.
export function isDirtyForm(form: FormState): boolean {
  const filledText = [
    form.title,
    form.address,
    form.description,
    form.equipment,
    form.orgName,
    form.contactName,
    form.contactPhone,
    form.addressLink,
    form.invoiceNumber,
    form.paymentAmount,
    form.paymentNote,
    form.timeFrom,
    form.timeTo,
    form.timeNote,
    form.actWaivedNote,
    form.carrierCost,
  ].some((v) => v.trim().length > 0);
  return (
    filledText ||
    form.assigneeId !== "" ||
    form.coDriverId !== "" ||
    form.priority ||
    form.paymentType !== "NONE" ||
    form.passStatus !== "NOT_NEEDED"
  );
}

// Короткая подпись черновика для чипа. Название → адрес → нейтральная заглушка.
export function draftLabel(form: FormState): string {
  return form.title.trim() || form.address.trim() || "Черновик заявки";
}

// Один свёрнутый черновик. id генерится на клиенте (crypto.randomUUID) при первом сворачивании.
export type TaskDraft = {
  id: string;
  form: FormState;
  savedAt: number; // время последнего сворачивания (для сортировки — свежие сверху)
  label: string;
};

// Версионированный ключ localStorage: при несовместимом изменении FormState поднимаем версию,
// чтобы не читать чужую форму старой раскладки.
export const DRAFTS_STORAGE_KEY = "vanmark:task-drafts:v1";
