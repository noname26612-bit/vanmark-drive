"use client";

// Затраты на внешнего перевозчика за период (этап 3, 02.07; вынесено в свой файл в v3).
// Секция скрыта, если завершённых задач внешних исполнителей в окне нет — пустой блок с нулями
// только занимал бы место на экране, где и так плотно.
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { StatTile } from "@/components/ui/stat-tile";
import { formatMoney } from "@/lib/task-ui";
import type { CarrierSummary, Granularity } from "@/lib/summary-dto";

/** Русское склонение: plural(2, ["задача","задачи","задач"]) → "задачи". */
function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function CarrierSection({ granularity, anchor }: { granularity: Granularity; anchor: string }) {
  const { data } = useSWR<CarrierSummary>(
    `/api/summary/carrier?granularity=${granularity}&date=${anchor}`,
    fetcher,
    { keepPreviousData: true },
  );
  const [open, setOpen] = useState(false);
  if (!data || data.taskCount === 0) return null;
  const unpriced = data.taskCount - data.pricedCount;
  return (
    <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-neutral-900">Внешний перевозчик</h2>
        <a
          href={`/api/summary/carrier/export?granularity=${granularity}&date=${anchor}`}
          className="text-sm font-medium text-neutral-600 underline-offset-2 hover:underline"
        >
          Скачать CSV
        </a>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label="затраты за период" value={formatMoney(data.totalCost)} tone="red" />
        <StatTile
          label={plural(data.taskCount, ["задача", "задачи", "задач"])}
          value={data.taskCount}
        />
        <StatTile label="средняя стоимость" value={data.avgCost != null ? formatMoney(data.avgCost) : "—"} />
      </div>
      {unpriced > 0 ? (
        <p className="mt-2 text-xs text-amber-700">
          У {unpriced} {plural(unpriced, ["задачи", "задач", "задач"])} стоимость не проставлена — сумма
          неполная.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 text-sm font-medium text-neutral-600 underline-offset-2 hover:underline"
      >
        {open ? "Скрыть задачи" : `Показать задачи (${data.taskCount})`}
      </button>
      {open ? (
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {data.tasks.map((t) => (
            <li key={t.taskId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="tabular-nums text-neutral-500">
                {t.dateKey.slice(8)}.{t.dateKey.slice(5, 7)}
              </span>
              <a
                href={`/tasks/${t.taskId}`}
                className="min-w-0 flex-1 truncate font-medium text-neutral-800 hover:underline"
              >
                №{t.number} · {t.title}
              </a>
              <span className="tabular-nums font-semibold text-neutral-900">
                {t.cost != null ? formatMoney(t.cost) : "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
