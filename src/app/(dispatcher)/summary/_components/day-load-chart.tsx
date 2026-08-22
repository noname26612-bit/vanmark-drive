"use client";

// График занятости по дням окна (Сводка v3). Два отличия от прежней «полоски без подписей»:
//   • шкала ФИКСИРОВАННАЯ — рабочий день из настроек ёмкости. Раньше высота считалась от максимума
//     окна, и полный столбик означал то 9 часов, то 40 минут: дни между собой не сравнивались.
//   • у каждого дня подпись (число и день недели) — иначе непонятно, где в окне провал.
// День длиннее нормы упирается в потолок (clamp 100%), точное значение остаётся в подсказке.
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format-duration";
import type { DriverDayLoad } from "@/lib/summary-dto";

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function weekdayOf(dateKey: string): string {
  return WEEKDAY[new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()];
}

export function DayLoadChart({
  days,
  workdayMinutes,
}: {
  days: DriverDayLoad[];
  workdayMinutes: number;
}) {
  if (days.length <= 1) return null; // в разрезе «День» графику по дням нечего показывать
  const scale = Math.max(60, workdayMinutes);
  return (
    <div data-testid="summary-day-chart">
      <div className="mb-1 flex items-baseline justify-between text-xs text-neutral-500">
        <span>Занятость по дням</span>
        <span className="text-[11px] text-neutral-400">
          шкала — рабочий день {formatDuration(workdayMinutes)}
        </span>
      </div>
      <div className="flex items-end gap-1">
        {days.map((d) => {
          const shiftPct = Math.min(100, Math.round((d.shiftMinutes / scale) * 100));
          const workedPct = Math.min(100, Math.round((d.workedMinutes / scale) * 100));
          const title =
            `${d.dateKey.slice(8)}.${d.dateKey.slice(5, 7)}: ` +
            `смена ${formatDuration(d.shiftMinutes)}, в работе ${formatDuration(d.workedMinutes)}`;
          return (
            <div key={d.dateKey} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div title={title} className="relative h-16 w-full rounded-sm bg-neutral-50">
                {/* Смена — серым фоном, отработанное — зелёным поверх (та же пара, что на доске). */}
                <div
                  className="absolute inset-x-0 bottom-0 rounded-sm bg-slate-300"
                  style={{ height: `${shiftPct}%` }}
                />
                <div
                  className="absolute inset-x-0 bottom-0 rounded-sm bg-green-500"
                  style={{ height: `${workedPct}%` }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] tabular-nums leading-none",
                  d.shiftMinutes > 0 ? "text-neutral-500" : "text-neutral-300",
                )}
              >
                {d.dateKey.slice(8)}
              </span>
              <span className="text-[10px] leading-none text-neutral-300">{weekdayOf(d.dateKey)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
