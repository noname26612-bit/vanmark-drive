"use client";

// Список за цифрой Сводки (drill-down v2, вынесен в свой файл в v3). Грузится лениво — только когда
// цифру раскрыли: за каждой из них отдельный запрос, и делать их пачкой на открытии экрана незачем.
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { formatDuration } from "@/lib/format-duration";
import { formatMoney } from "@/lib/task-ui";
import type { Granularity, SummaryDetailMetric, SummaryDetailRow } from "@/lib/summary-dto";

export function DetailList({
  metric,
  title,
  granularity,
  anchor,
  driverId,
}: {
  metric: SummaryDetailMetric;
  title: string;
  granularity: Granularity;
  anchor: string;
  driverId?: string;
}) {
  const url = `/api/summary/details?metric=${metric}&granularity=${granularity}&date=${anchor}${
    driverId ? `&driverId=${driverId}` : ""
  }`;
  const { data, isLoading } = useSWR<SummaryDetailRow[]>(url, fetcher);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-2" data-testid="summary-detail">
      <div className="px-1 pb-1 text-xs font-medium text-neutral-500">{title}</div>
      {isLoading && !data ? (
        <p className="px-1 py-1 text-sm text-neutral-400">Загрузка…</p>
      ) : !data || data.length === 0 ? (
        <p className="px-1 py-1 text-sm text-neutral-400">Пусто за период.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-md border border-neutral-100">
          {data.map((r, i) => (
            <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                {r.dateKey.slice(8)}.{r.dateKey.slice(5, 7)}
              </span>
              {r.taskId ? (
                <Link
                  href={`/tasks/${r.taskId}`}
                  className="min-w-0 flex-1 truncate font-medium text-neutral-800 hover:underline"
                >
                  {r.number ? `№${r.number} · ` : ""}
                  {r.title}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-neutral-700">{r.title}</span>
              )}
              {!driverId && r.driverName ? (
                <span className="shrink-0 text-xs text-neutral-400">{r.driverName}</span>
              ) : null}
              {r.extra ? (
                <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">{r.extra}</span>
              ) : null}
              {r.minutes != null ? (
                <span className="shrink-0 tabular-nums font-medium text-neutral-700">
                  {formatDuration(r.minutes)}
                </span>
              ) : null}
              {r.amount != null ? (
                <span className="shrink-0 tabular-nums font-semibold text-neutral-900">
                  {formatMoney(r.amount)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
