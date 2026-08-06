// Подписи и цвета модуля «Станки». Палитра — строго из ui-guidelines (та же, что у задач):
// графитовая база, три смысловых акцента — зелёный «готово», красный «сорвано», янтарный
// «требует действия сейчас». Активная фаза («В ремонте») выделена синей заливкой, как «В работе»
// у задач: то, чем занимаются прямо сейчас, должно бросаться в глаза.
// Классы — строками-литералами, иначе Tailwind их не увидит.
import type { MachineCategory, MachineStatus } from "@/generated/prisma/enums";
import { MACHINE_CATEGORY_LABEL, MACHINE_STATUS_LABEL } from "@/domain/machine-status";

export { MACHINE_CATEGORY_LABEL, MACHINE_STATUS_LABEL };

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
 * Заголовок карточки по решению Артёма о маркировке: у наших — привычный «77-N» впереди и
 * учётный номер следом, у клиентских — учётный номер и № заказа 1С («№214 · заказ 4512»).
 */
export function machineTitle(m: {
  number: number;
  ourNumber: number | null;
  invoice1C: string | null;
}): string {
  if (m.ourNumber !== null) return `77-${m.ourNumber} · №${m.number}`;
  const order = m.invoice1C?.trim();
  return order ? `№${m.number} · заказ ${order}` : `№${m.number}`;
}

/** «дд.мм.гггг» из «YYYY-MM-DD» (без сдвига по таймзоне — режем строку). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "—";
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
  photo_added: "Добавлено фото",
  photo_removed: "Удалено фото",
};
