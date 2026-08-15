// Подписи и цвета модуля «Станки». Палитра — строго из ui-guidelines (та же, что у задач):
// графитовая база, три смысловых акцента — зелёный «готово», красный «сорвано», янтарный
// «требует действия сейчас». Активная фаза («В ремонте») выделена синей заливкой, как «В работе»
// у задач: то, чем занимаются прямо сейчас, должно бросаться в глаза.
// Классы — строками-литералами, иначе Tailwind их не увидит.
import type { MachineCategory, MachineStatus } from "@/generated/prisma/enums";
import {
  EQUIPMENT_FAMILY_LABEL,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_PLURAL,
  EQUIPMENT_KIND_SHORT,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
} from "@/domain/machine-status";
import type { DueState } from "@/domain/machine-flags";

export {
  EQUIPMENT_FAMILY_LABEL,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_PLURAL,
  EQUIPMENT_KIND_SHORT,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
};

export const MACHINE_STATUS_BADGE: Record<MachineStatus, string> = {
  ACCEPTED: "border border-slate-300 text-slate-600",
  NEEDS_REPAIR: "border border-amber-500 text-amber-700", // ждёт действия — в ремонт его
  IN_REPAIR: "bg-blue-600 text-white", // работа идёт прямо сейчас
  READY: "border border-green-600 text-green-700",
  RENTED: "border border-slate-300 text-slate-600",
  RELEASED: "border border-slate-300 text-slate-500",
  SOLD: "border border-slate-300 text-slate-500",
  VOIDED: "border border-red-600 text-red-700", // ошибочная карточка
};

/**
 * Заливка ВЫБРАННОЙ кнопки состояния в карточке (решение Артёма 15.08.2026: состояния переключаются
 * кнопками, а не выпадашкой). Смысл тот же, что у бейджей, но насыщенный: из ряда одинаковых плашек
 * текущее состояние должно читаться мгновенно, с телефона и на вытянутой руке.
 */
export const MACHINE_STATUS_ACTIVE: Record<MachineStatus, string> = {
  ACCEPTED: "border-slate-600 bg-slate-600 text-white",
  NEEDS_REPAIR: "border-amber-600 bg-amber-600 text-white", // ждёт действия — в ремонт его
  IN_REPAIR: "border-blue-600 bg-blue-600 text-white", // работа идёт прямо сейчас
  READY: "border-green-600 bg-green-600 text-white",
  RENTED: "border-slate-700 bg-slate-700 text-white",
  RELEASED: "border-slate-500 bg-slate-500 text-white",
  SOLD: "border-slate-700 bg-slate-700 text-white",
  VOIDED: "border-red-600 bg-red-600 text-white", // ошибочная карточка
};

// Левый «корешок» строки списка (3px), как у карточек задач.
export const MACHINE_STATUS_BAR: Record<MachineStatus, string> = {
  ACCEPTED: "bg-slate-300",
  NEEDS_REPAIR: "bg-amber-500",
  IN_REPAIR: "bg-blue-600",
  READY: "bg-green-600",
  RENTED: "bg-slate-300",
  RELEASED: "bg-slate-200",
  SOLD: "bg-slate-200",
  VOIDED: "bg-red-600",
};

export const MACHINE_CATEGORY_SHORT: Record<MachineCategory, string> = {
  CLIENT: "Клиентский",
  OUR_SALE: "Продажа",
  OUR_RENTAL: "Аренда",
};

/**
 * Заголовок карточки — учётный номер «77-N», который пишут маркером на железе (решение Артёма
 * 15.08.2026). Сквозной системный номер (Machine.number) из интерфейса убран совсем: две нумерации
 * рядом («77-5 · №9») путали, а вторую никто не использовал.
 *
 * Карточка без номера подписывается моделью — номер необязателен, и заголовок «—» был бы хуже
 * пустого места. № заказа 1С остаётся приметой клиентских станков.
 */
export function machineTitle(m: {
  ourNumber: number | null;
  model?: string;
  invoice1C: string | null;
}): string {
  if (m.ourNumber !== null) return `77-${m.ourNumber}`;
  const order = m.invoice1C?.trim();
  if (order) return `заказ ${order}`;
  return m.model?.trim() || "Без номера";
}

/** «дд.мм.гггг» из «YYYY-MM-DD» (без сдвига по таймзоне — режем строку). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "—";
}

/** «дд.мм» из «YYYY-MM-DD» — для компактного бейджа срока в списке. */
export function formatDayShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}.${m[1]}` : "—";
}

// Бейдж срока: красный ТОЛЬКО «просрочен», янтарный ТОЛЬКО «горит ≤2 дней» (ui-guidelines);
// null (спокойный срок, аренда, архив) — нейтральный графит.
export const DUE_BADGE: Record<Exclude<DueState, null> | "neutral", string> = {
  overdue: "border border-red-600 text-red-700",
  soon: "border border-amber-500 text-amber-700",
  neutral: "border border-slate-300 text-slate-500",
};

export function dueBadgeClass(state: DueState): string {
  return DUE_BADGE[state ?? "neutral"];
}

/** ISO-момент → «дд.мм чч:мм» для ленты журнала. */
export function formatMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Подпись события журнала. */
export const EVENT_LABEL: Record<string, string> = {
  created: "Заведён",
  status_change: "Состояние",
  edit: "Правка",
  comment: "Комментарий",
  shop_task: "Задание в цех",
  photo_added: "Добавлено фото",
  photo_removed: "Удалено фото",
};
