// Подписи, цвета и форматтеры для интерфейса задач. Цвета статусов — строго из ui-guidelines.
// Классы записаны строками-литералами, чтобы Tailwind их увидел и сгенерировал.
//
// Палитра «спокойная» (редизайн 18.06, решение Артёма): уходим от радуги из 9 цветов к графитовой
// базе с тремя смысловыми акцентами — зелёный = готово (Выполнена), красный = сорвано (Отменена),
// янтарный = требует внимания сейчас (Ждёт / нужен пропуск). Все остальные статусы — нейтральный
// графит, различаются словом-подписью. Бейджи контурные (border + text), без заливок и «таблеток».
import type { PassStatus, PaymentType, TaskStatus } from "@/generated/prisma/enums";
import type { ActState } from "@/domain/act";

// Подписи статусов. IN_PROGRESS «В работе» — рабочая фаза водителя (этап A). ACCEPTED/EN_ROUTE/ON_SITE —
// LEGACY: новым задачам не присваиваются, подписи оставлены, чтобы корректно показывать старую историю.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  NEW: "Новая",
  ASSIGNED: "Назначена",
  IN_PROGRESS: "В работе",
  ACCEPTED: "Принята", // legacy
  EN_ROUTE: "В пути", // legacy
  ON_SITE: "На месте", // legacy
  DONE: "Завершена",
  ON_HOLD: "На паузе",
  RESCHEDULED: "Перенесена",
  CANCELLED: "Отменена",
};

// Бейдж статуса — контурная метка (рамка + текст, прозрачный фон). Графит для нейтральных,
// акцент только у «готово» (зелёный), «сорвано» (красный) и «внимание» (янтарь). Исключение —
// «В работе»: НАСЫЩЕННАЯ синяя заливка + крупнее (StatusBadge size md). Прежняя мягкая заливка
// bg-blue-50 (Артём 24.06) почти терялась на доске — усилено до сплошного синего (решение Артёма
// 07.07): активная задача должна сразу бросаться в глаза и у водителя, и у диспетчера.
export const STATUS_BADGE: Record<TaskStatus, string> = {
  NEW: "border border-slate-300 text-slate-600",
  ASSIGNED: "border border-slate-300 text-slate-600",
  IN_PROGRESS: "bg-blue-600 text-white",
  ACCEPTED: "border border-slate-300 text-slate-600", // legacy
  EN_ROUTE: "border border-slate-300 text-slate-600", // legacy
  ON_SITE: "border border-slate-300 text-slate-600", // legacy
  DONE: "border border-green-600 text-green-700",
  ON_HOLD: "border border-amber-500 text-amber-700",
  RESCHEDULED: "border border-slate-300 text-slate-600",
  CANCELLED: "border border-red-600 text-red-700",
};

// Статусы, у которых плашку-бейдж не показываем вовсе (визуальный шум). «Назначена» — самый частый
// рабочий статус, метка не несёт информации (решение Артёма 24.06). «Новая» оставляем — это сигнал
// «ещё не назначена никому». Единая точка правды для всех экранов — компонент StatusBadge.
const HIDDEN_STATUS_BADGES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["ASSIGNED"]);

/** Скрыта ли плашка статуса (для ASSIGNED — да). Используется компонентом StatusBadge. */
export function isStatusBadgeHidden(status: TaskStatus): boolean {
  return HIDDEN_STATUS_BADGES.has(status);
}

// Левая полоса-«корешок» карточки. Нейтральный графит для большинства; цвет загорается только
// у трёх смысловых состояний (готово / сорвано / внимание).
export const STATUS_BAR: Record<TaskStatus, string> = {
  NEW: "bg-slate-300",
  ASSIGNED: "bg-slate-300",
  IN_PROGRESS: "bg-slate-300",
  ACCEPTED: "bg-slate-300", // legacy
  EN_ROUTE: "bg-slate-300", // legacy
  ON_SITE: "bg-slate-300", // legacy
  DONE: "bg-green-600",
  ON_HOLD: "bg-amber-600",
  RESCHEDULED: "bg-slate-300",
  CANCELLED: "bg-red-600",
};

export const PASS_LABEL: Record<PassStatus, string> = {
  NOT_NEEDED: "Пропуск не нужен",
  NEEDED: "Нужен пропуск!",
  ORDERED: "Пропуск заказан",
};

// Пропуск: «нужен» — янтарный сигнал внимания; «заказан» — спокойный графит (вопрос закрыт,
// подсвечивать нечего). Контурные.
export const PASS_BADGE: Record<PassStatus, string> = {
  NOT_NEEDED: "border border-slate-300 text-slate-500",
  NEEDED: "border border-amber-500 text-amber-700",
  ORDERED: "border border-slate-300 text-slate-600",
};

// Бейдж комплектности акта (этап 14, PRD §13). Цвет — строго по ui-guidelines: зелёный = готово
// (приложен), янтарь = требует действия сейчас (нужен, но задача уже завершена без акта), графит =
// нейтрально (ещё ожидается до завершения / снят диспетчером). null — показывать нечего (акт не нужен).
export function actBadge(
  state: ActState,
  isDone: boolean,
): { label: string; className: string } | null {
  switch (state) {
    case "COMPLETE":
      return { label: "Акт приложен", className: "border border-green-600 text-green-700" };
    case "PENDING":
      return isDone
        ? { label: "Акт не приложен", className: "border border-amber-500 text-amber-700" }
        : { label: "Акт ожидается", className: "border border-slate-300 text-slate-500" };
    case "WAIVED":
      return { label: "Акт не нужен", className: "border border-slate-300 text-slate-500" };
    case "NOT_REQUIRED":
      return null;
  }
}

export const PAYMENT_LABEL: Record<PaymentType, string> = {
  NONE: "Без оплаты",
  OFFICE: "Через офис",
  ON_SITE: "Оплата на месте",
};

// Порядок статусов для фильтров/выбора (актуальные). Legacy ACCEPTED/EN_ROUTE/ON_SITE сюда не входят —
// новых задач в них нет, в фильтре их предлагать незачем (история показывается своими подписями).
export const STATUS_ORDER: TaskStatus[] = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
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
