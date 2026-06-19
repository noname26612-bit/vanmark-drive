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

/** Русское склонение: plural(2, ["ремонт","ремонта","ремонтов"]) → "ремонта". */
function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function structureLabel(repair: number, delivery: number): string {
  return `${repair} ${plural(repair, ["ремонт", "ремонта", "ремонтов"])} · ${delivery} ${plural(delivery, ["доставка", "доставки", "доставок"])}`;
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
          <ComparePanel drivers={data.drivers} />
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
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

/** Полоса «ремонты / доставки» одного водителя. */
function StructureBar({ repair, delivery }: { repair: number; delivery: number }) {
  const total = repair + delivery;
  if (total === 0) return <div className="h-2.5 rounded bg-neutral-100" />;
  const repairPct = (repair / total) * 100;
  return (
    <div className="flex h-2.5 overflow-hidden rounded bg-neutral-100">
      <div className="bg-neutral-700" style={{ width: `${repairPct}%` }} />
      <div className="bg-neutral-400" style={{ width: `${100 - repairPct}%` }} />
    </div>
  );
}

/** Метрика-проблема с цветной точкой: 0 — приглушённо, >0 — акцент по тону. */
function ProblemChip({ label, value, tone }: { label: string; value: number; tone: "warn" | "danger" | "muted" }) {
  const active = value > 0;
  const dot = !active
    ? "bg-neutral-300"
    : tone === "warn"
      ? "bg-amber-500"
      : tone === "danger"
        ? "bg-red-500"
        : "bg-neutral-400";
  const num = !active
    ? "text-neutral-400"
    : tone === "warn"
      ? "text-amber-700"
      : tone === "danger"
        ? "text-red-600"
        : "text-neutral-700";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      <span className="text-neutral-500">{label}</span>
      <span className={cn("font-medium", num)}>{value}</span>
    </span>
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

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-500">
          <span>Структура работ</span>
          <span>{structureLabel(driver.repairCount, driver.deliveryCount)}</span>
        </div>
        <StructureBar repair={driver.repairCount} delivery={driver.deliveryCount} />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <ProblemChip label="Поздние смены" value={driver.lateCount} tone="warn" />
        <ProblemChip label="Невып. точки" value={driver.missedStopCount} tone="danger" />
        <ProblemChip label="Отмены" value={driver.cancelledCount} tone="muted" />
        <ProblemChip label="Переносы" value={driver.rescheduledCount} tone="muted" />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-4 border-t border-neutral-100 pt-2.5 text-sm">
        <TimeStat label="На задаче (ср.)" value={formatOnSite(driver.avgOnSiteMinutes)} />
        <TimeStat label="Отработано" value={formatOnSite(driver.workedMinutes)} />
        <TimeStat label="Простой" value={formatOnSite(driver.idleMinutes)} />
      </div>
    </div>
  );
}

function TimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-800">{value}</span>
    </div>
  );
}

/** Сравнение водителей за период: длина полосы = выполнено в общем масштабе, сегменты — ремонты/доставки. */
function ComparePanel({ drivers }: { drivers: DriverSummaryView[] }) {
  const maxDone = Math.max(1, ...drivers.map((d) => d.doneCount));
  return (
    <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-700">Кто сколько закрыл за период</span>
        <span className="flex items-center gap-3 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-neutral-700" /> Ремонты
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-neutral-400" /> Доставки
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {drivers.map((d) => {
          const repairPct = d.doneCount > 0 ? (d.repairCount / maxDone) * 100 : 0;
          const deliveryPct = d.doneCount > 0 ? (d.deliveryCount / maxDone) * 100 : 0;
          return (
            <div key={d.driverId} className="flex items-center gap-3">
              <span className="w-36 shrink-0 truncate text-sm text-neutral-700" title={d.driverName}>
                {d.driverName}
              </span>
              <div className="flex h-3.5 flex-1 overflow-hidden rounded bg-neutral-100">
                <div className="bg-neutral-700" style={{ width: `${repairPct}%` }} />
                <div className="bg-neutral-400" style={{ width: `${deliveryPct}%` }} />
              </div>
              <span
                className={cn(
                  "w-6 shrink-0 text-right text-sm font-medium",
                  d.doneCount > 0 ? "text-neutral-800" : "text-neutral-400",
                )}
              >
                {d.doneCount}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TotalsBar({ totals, label }: { totals: SummaryTotals; label: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm">
      <span className="font-medium text-neutral-800">Итого · {label}</span>
      <span className="text-neutral-500">
        выполнено <b className="font-medium text-neutral-800">{totals.doneCount}</b> · поздние смены{" "}
        <b className="font-medium text-neutral-800">{totals.lateCount}</b> · невып. точки{" "}
        <b className="font-medium text-neutral-800">{totals.missedStopCount}</b> · простой{" "}
        <b className="font-medium text-neutral-800">{formatOnSite(totals.idleMinutes)}</b>
      </span>
    </div>
  );
}
