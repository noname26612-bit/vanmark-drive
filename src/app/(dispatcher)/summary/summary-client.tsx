"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { GRANULARITIES, normalizeAnchor, shiftAnchor, formatWindowLabel, type Granularity } from "@/domain/summary";
import type { SummaryOverview, DriverSummaryView, SummaryTotals } from "@/lib/summary-dto";

const GRAN_LABEL: Record<Granularity, string> = { day: "День", week: "Неделя", month: "Месяц" };

/** Минуты → «1 ч 12 мин» / «34 мин» / «—». */
function formatOnSite(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function SummaryClient({ initialAnchor }: { initialAnchor: string }) {
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [anchor, setAnchor] = useState(initialAnchor);

  const { data, isLoading } = useSWR<SummaryOverview>(
    `/api/summary/overview?granularity=${granularity}&date=${anchor}`,
    fetcher,
  );

  function changeGranularity(g: Granularity) {
    setGranularity(g);
    setAnchor((a) => normalizeAnchor(g, a));
  }

  const label = formatWindowLabel(granularity, anchor);
  const exportUrl = `/api/summary/export?granularity=${granularity}&date=${anchor}`;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Сводка по водителям</h1>
          <p className="mt-1 text-sm text-neutral-500">Что наработали за период — по дате закрытия задач.</p>
        </div>
        <a
          href={exportUrl}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
        >
          Скачать CSV
        </a>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300">
          {GRANULARITIES.map((g) => (
            <button
              key={g}
              onClick={() => changeGranularity(g)}
              className={cn(
                "px-3.5 py-2 text-sm font-medium transition-colors",
                granularity === g ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50",
              )}
            >
              {GRAN_LABEL[g]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="h-9 w-9 px-0"
            onClick={() => setAnchor(shiftAnchor(granularity, anchor, -1))}
            aria-label="Предыдущий период"
          >
            ◀
          </Button>
          <span className="min-w-44 text-center text-sm font-medium text-neutral-800">{label}</span>
          <Button
            variant="secondary"
            className="h-9 w-9 px-0"
            onClick={() => setAnchor(shiftAnchor(granularity, anchor, 1))}
            aria-label="Следующий период"
          >
            ▶
          </Button>
        </div>
      </div>

      {isLoading && !data ? (
        <p className="mt-6 text-sm text-neutral-400">Загрузка…</p>
      ) : !data || data.drivers.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">Нет активных водителей.</p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {data.drivers.map((d) => (
              <DriverCard key={d.driverId} driver={d} />
            ))}
          </div>
          <TotalsBar totals={data.totals} label={label} />
        </>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  const color = tone === "warn" && value > 0 ? "text-amber-700" : tone === "danger" && value > 0 ? "text-red-600" : "text-neutral-800";
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className={cn("font-medium", color)}>{value}</span>
    </div>
  );
}

function DriverCard({ driver }: { driver: DriverSummaryView }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">{driver.driverName}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-neutral-900">{driver.doneCount}</span>
          <span className="text-xs text-neutral-500">выполнено</span>
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <Metric label="Ремонты" value={driver.repairCount} />
        <Metric label="Доставки" value={driver.deliveryCount} />
        <Metric label="Опоздания" value={driver.lateCount} tone="warn" />
        <Metric label="Невып. точки" value={driver.missedStopCount} tone="danger" />
        <Metric label="Отмены" value={driver.cancelledCount} />
        <Metric label="Переносы" value={driver.rescheduledCount} />
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-neutral-100 pt-2.5 text-sm">
        <span className="text-neutral-500">Среднее на объекте</span>
        <span className="font-medium text-neutral-800">{formatOnSite(driver.avgOnSiteMinutes)}</span>
      </div>
    </div>
  );
}

function TotalsBar({ totals, label }: { totals: SummaryTotals; label: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm">
      <span className="font-medium text-neutral-800">Итого · {label}</span>
      <span className="text-neutral-500">
        выполнено <b className="font-medium text-neutral-800">{totals.doneCount}</b> · опоздания{" "}
        <b className="font-medium text-neutral-800">{totals.lateCount}</b> · невып. точки{" "}
        <b className="font-medium text-neutral-800">{totals.missedStopCount}</b> · отмены{" "}
        <b className="font-medium text-neutral-800">{totals.cancelledCount}</b> · переносы{" "}
        <b className="font-medium text-neutral-800">{totals.rescheduledCount}</b>
      </span>
    </div>
  );
}
