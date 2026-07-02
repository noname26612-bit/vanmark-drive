// Сериализуемые типы «Сводки по водителям» для границы сервер↔клиент (как kpi-dto/task-dto).
// Без импортов prisma-клиента — безопасно использовать в клиентских компонентах.
// Арифметика окна периода — в src/domain/summary.ts.
// Сводка v2 (решение Артёма 02.07): разбивка по типам работ УБРАНА; добавлены занятость по дням,
// план/факт времени, зафиксированный простой и деньги за период. Рублёвые метрики, производные от
// оклада (простой в ₽), — ТОЛЬКО админу (payrollVisible), диспетчеру сервер отдаёт null (№10).
import type { Granularity } from "@/domain/summary";

export type { Granularity };

/** Занятость одного дня окна: отработано и длительность смены (для мини-графика по дням). */
export type DriverDayLoad = {
  dateKey: string; // YYYY-MM-DD
  workedMinutes: number; // время «В работе → Завершено» за день
  shiftMinutes: number; // длительность закрытых смен за день; 0 — смены не было
};

/** Метрики одного водителя за период. */
export type DriverSummaryView = {
  driverId: string;
  driverName: string;
  isExternal: boolean; // внешний перевозчик: без смен, загрузка не считается
  doneCount: number; // выполнено задач (по дате закрытия в окне)
  lateCount: number; // подтверждённые «поздно открыл смену» (KPI)
  missedStopCount: number; // подтверждённые невыполненные точки (KPI)
  cancelledCount: number; // отмен в окне (по журналу)
  rescheduledCount: number; // переносов в окне (по журналу)
  avgOnSiteMinutes: number | null; // среднее «Завершено − В работе», мин; null — нет данных
  workedMinutes: number; // отработано на задачах (сумма «В работе → Завершено»), мин (этап D)
  idleMinutes: number; // простой = смены − отработано, мин (этап D, по закрытым сменам)
  shiftMinutes: number; // суммарная длительность закрытых смен окна, мин
  loadPercent: number | null; // коэффициент загрузки = worked/shift; null — смен в окне нет
  days: DriverDayLoad[]; // занятость по дням окна (для мини-графика; включая дни без смен)
  planMinutes: number; // Σ оценок времени (estimatedMinutes) по задачам, где есть и оценка, и факт
  factMinutes: number; // Σ факта по тем же задачам — честное сравнение план/факт
  planFactCount: number; // по скольким задачам сравниваем
  idleNotedMinutes: number; // зафиксированный Миленой простой (пометки DriverIdleNote), мин
};

/** Итоги по всем водителям. */
export type SummaryTotals = {
  doneCount: number;
  lateCount: number;
  missedStopCount: number;
  cancelledCount: number;
  rescheduledCount: number;
  avgOnSiteMinutes: number | null;
  workedMinutes: number;
  idleMinutes: number;
  shiftMinutes: number;
  loadPercent: number | null;
  planMinutes: number;
  factMinutes: number;
  idleNotedMinutes: number;
};

/** Деньги за период (Сводка v2): получено по задачам vs затраты. Рублёвые поля, производные от
 *  оклада (idleCost/idleNotedCost), сервер считает ТОЛЬКО для админа; диспетчеру — null (№10). */
export type SummaryMoney = {
  paymentsReceived: number; // Σ полученных оплат «на месте» (paymentReceived=true), ₽
  pricedWorks: number; // Σ расценённых работ (ведомости PRICED/SIGNED), ₽
  receivedTotal: number; // получено всего, ₽
  carrierCost: number; // затраты на внешних перевозчиков (Task.carrierCost по DONE), ₽
  idleCost: number | null; // цена простоя: часы простоя × (оклад / нормо-часы); только админ
  idleNotedCost: number | null; // цена зафиксированного простоя (пометки); только админ
};

export type SummaryOverview = {
  granularity: Granularity;
  anchor: string; // нормализованный якорь окна (YYYY-MM-DD)
  fromKey: string; // начало окна (включительно)
  toKey: string; // конец окна (включительно)
  payrollVisible: boolean; // админ: рублёвые метрики от оклада присутствуют; диспетчеру — null
  drivers: DriverSummaryView[];
  totals: SummaryTotals;
  money: SummaryMoney;
};

// ─── Drill-down (клик по цифре → список за ней) ───

export const SUMMARY_DETAIL_METRICS = [
  "done",
  "late",
  "missed",
  "cancelled",
  "rescheduled",
  "idle-notes",
  "plan-fact",
  "payments",
  "priced-works",
  "carrier",
  "shifts",
] as const;

export type SummaryDetailMetric = (typeof SUMMARY_DETAIL_METRICS)[number];

/** Унифицированная строка детализации: задача/смена/пометка за цифрой Сводки. */
export type SummaryDetailRow = {
  taskId?: string; // есть — строка ведёт в карточку задачи
  number?: number;
  title: string;
  dateKey: string; // YYYY-MM-DD (МСК)
  driverName?: string;
  minutes?: number;
  amount?: number; // ₽
  extra?: string; // доп. подпись (причина, план→факт и т.п.)
};

// ─── Затраты на внешнего перевозчика (этап 3, решение Артёма 02.07) ───

/** Строка отчёта: завершённая задача внешнего исполнителя со стоимостью поездки. */
export type CarrierTaskRow = {
  taskId: string;
  number: number;
  title: string;
  dateKey: string; // день завершения (МСК, YYYY-MM-DD)
  cost: number | null; // Task.carrierCost, ₽; null — диспетчер ещё не проставил
  driverName: string; // на будущее: внешних может стать больше одного
};

/** Сводка затрат на внешних перевозчиков за окно периода (по completedAt, как вся Сводка). */
export type CarrierSummary = {
  granularity: Granularity;
  anchor: string;
  fromKey: string;
  toKey: string;
  taskCount: number; // завершённых задач внешних исполнителей в окне
  pricedCount: number; // из них со стоимостью
  totalCost: number; // сумма затрат, ₽
  avgCost: number | null; // средняя по задачам со стоимостью; null — нет данных
  tasks: CarrierTaskRow[];
};
