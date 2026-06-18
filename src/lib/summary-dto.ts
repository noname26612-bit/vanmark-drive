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
  avgOnSiteMinutes: number | null; // среднее «Выполнено − На месте», мин; null — нет данных
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
};

export type SummaryOverview = {
  granularity: Granularity;
  anchor: string; // нормализованный якорь окна (YYYY-MM-DD)
  fromKey: string; // начало окна (включительно)
  toKey: string; // конец окна (включительно)
  drivers: DriverSummaryView[];
  totals: SummaryTotals;
};
