// Сериализуемые типы «Сводки по водителям» для границы сервер↔клиент (как kpi-dto/task-dto).
// Без импортов prisma-клиента — безопасно использовать в клиентских компонентах.
// Арифметика окна периода — в src/domain/summary.ts.
import type { Granularity } from "@/domain/summary";

export type { Granularity };

/** Разбивка выполненных задач по типу. */
export type TypeBreakdown = {
  typeId: string;
  typeName: string;
  isRepair: boolean; // тип с requiresSignedDoc — ремонтный
  count: number;
};

/** Метрики одного водителя за период. */
export type DriverSummaryView = {
  driverId: string;
  driverName: string;
  doneCount: number; // выполнено задач (по дате закрытия в окне)
  repairCount: number; // из них ремонтных типов
  deliveryCount: number; // из них доставочных типов
  byType: TypeBreakdown[]; // разбивка по конкретным типам
  lateCount: number; // подтверждённые опоздания (KPI)
  missedStopCount: number; // подтверждённые невыполненные точки (KPI)
  cancelledCount: number; // отмен в окне (по журналу)
  rescheduledCount: number; // переносов в окне (по журналу)
  avgOnSiteMinutes: number | null; // среднее «Завершено − В работе», мин; null — нет данных
  workedMinutes: number; // отработано на задачах (сумма «В работе → Завершено»), мин (этап D)
  idleMinutes: number; // простой = смены − отработано, мин (этап D)
};

/** Итоги по всем водителям. */
export type SummaryTotals = {
  doneCount: number;
  repairCount: number;
  deliveryCount: number;
  lateCount: number;
  missedStopCount: number;
  cancelledCount: number;
  rescheduledCount: number;
  avgOnSiteMinutes: number | null;
  workedMinutes: number;
  idleMinutes: number;
};

export type SummaryOverview = {
  granularity: Granularity;
  anchor: string; // нормализованный якорь окна (YYYY-MM-DD)
  fromKey: string; // начало окна (включительно)
  toKey: string; // конец окна (включительно)
  drivers: DriverSummaryView[];
  totals: SummaryTotals;
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
