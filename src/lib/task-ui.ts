// Подписи, цвета и форматтеры для интерфейса задач. Цвета статусов — строго из ui-guidelines.
// Классы записаны строками-литералами, чтобы Tailwind их увидел и сгенерировал.
import type { PassStatus, PaymentType, TaskStatus } from "@/generated/prisma/enums";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  NEW: "Новая",
  ASSIGNED: "Назначена",
  ACCEPTED: "Принята",
  EN_ROUTE: "В пути",
  ON_SITE: "На месте",
  DONE: "Выполнена",
  ON_HOLD: "Ждёт",
  RESCHEDULED: "Перенесена",
  CANCELLED: "Отменена",
};

// Бейдж статуса (фон + текст).
export const STATUS_BADGE: Record<TaskStatus, string> = {
  NEW: "bg-slate-100 text-slate-700",
  ASSIGNED: "bg-violet-100 text-violet-700",
  ACCEPTED: "bg-indigo-100 text-indigo-700",
  EN_ROUTE: "bg-blue-100 text-blue-700",
  ON_SITE: "bg-orange-100 text-orange-700",
  DONE: "bg-green-100 text-green-700",
  ON_HOLD: "bg-amber-100 text-amber-800",
  RESCHEDULED: "bg-sky-100 text-sky-700",
  CANCELLED: "bg-red-100 text-red-700",
};

// Левая цветная полоса карточки.
export const STATUS_BAR: Record<TaskStatus, string> = {
  NEW: "bg-slate-400",
  ASSIGNED: "bg-violet-500",
  ACCEPTED: "bg-indigo-500",
  EN_ROUTE: "bg-blue-500",
  ON_SITE: "bg-orange-500",
  DONE: "bg-green-600",
  ON_HOLD: "bg-amber-500",
  RESCHEDULED: "bg-sky-400",
  CANCELLED: "bg-red-500",
};

export const PASS_LABEL: Record<PassStatus, string> = {
  NOT_NEEDED: "Пропуск не нужен",
  NEEDED: "Нужен пропуск!",
  ORDERED: "Пропуск заказан",
};

export const PASS_BADGE: Record<PassStatus, string> = {
  NOT_NEEDED: "bg-neutral-100 text-neutral-500",
  NEEDED: "bg-amber-100 text-amber-800",
  ORDERED: "bg-green-100 text-green-700",
};

export const PAYMENT_LABEL: Record<PaymentType, string> = {
  NONE: "Без оплаты",
  OFFICE: "Через офис",
  ON_SITE: "Оплата на месте",
};

export const STATUS_ORDER: TaskStatus[] = [
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "EN_ROUTE",
  "ON_SITE",
  "ON_HOLD",
  "RESCHEDULED",
  "DONE",
  "CANCELLED",
];

/** ISO-дату (или Date) — в «дд.мм.гггг». Берём части строки, чтобы не было сдвига по таймзоне. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value : value.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Дата → короткий «дд.мм». */
export function formatDateShort(value: string | Date | null | undefined): string {
  const full = formatDate(value);
  return full === "—" ? full : full.slice(0, 5);
}

export function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

/** ISO datetime → «дд.мм чч:мм» (для ленты истории), в местной зоне. */
export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ссылка для кнопки «Навигатор»: готовый deeplink из задачи (Яндекс/2ГИС) или, если его нет,
 *  поиск по тексту адреса в Яндекс.Картах — чтобы кнопка работала всегда. */
export function navUrl(addressLink: string | null | undefined, address: string): string {
  const link = addressLink?.trim();
  if (link) return link;
  return `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
}

/** Сегодня в формате YYYY-MM-DD (местная зона) — для фильтра доски. */
export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Сдвиг даты «YYYY-MM-DD» на n дней (UTC — без сдвига зоны). Для горизонта доски/планирования. */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** Период «YYYY-MM» → «июнь 2026» (для KPI/зарплаты). */
export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return period;
  return `${MONTHS_RU[m - 1]} ${y}`;
}

/** Сдвиг периода «YYYY-MM» на delta месяцев (для переключателя месяца). */
export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
