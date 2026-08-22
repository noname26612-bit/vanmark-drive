"use client";

// Раскрытая строка водителя (Сводка v3): график занятости по дням + список за нажатой цифрой.
// Прогрессивное раскрытие — вместо 14 метрик мелким текстом в каждой карточке: в таблице видно
// сравнение водителей, подробности — по клику ровно на ту цифру, о которой возник вопрос.
import { DayLoadChart } from "./day-load-chart";
import { DetailList } from "./detail-list";
import type { DriverSummaryView, Granularity, SummaryDetailMetric } from "@/lib/summary-dto";

export function DriverDetails({
  driver,
  metric,
  title,
  granularity,
  anchor,
  workdayMinutes,
}: {
  driver: DriverSummaryView;
  metric: SummaryDetailMetric;
  title: string;
  granularity: Granularity;
  anchor: string;
  workdayMinutes: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="text-xs font-medium text-neutral-500">
        {driver.driverName} · {title}
      </div>
      {/* Внешнему перевозчику график не рисуем: смен у него нет (PRD §4), шкала была бы пустой. */}
      {driver.isExternal ? null : (
        <DayLoadChart days={driver.days} workdayMinutes={workdayMinutes} />
      )}
      <DetailList
        metric={metric}
        title={title}
        granularity={granularity}
        anchor={anchor}
        driverId={driver.driverId}
      />
    </div>
  );
}
