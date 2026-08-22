"use client";

// Шапка Сводки: период (сегмент + стрелки + «Сегодня») и выгрузка. Выделена из клиента, чтобы
// таблица и итоги читались отдельно от управления периодом.
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { GRANULARITIES, formatWindowLabel, type Granularity } from "@/domain/summary";

const GRAN_LABEL: Record<Granularity, string> = { day: "День", week: "Неделя", month: "Месяц" };
const OPTIONS = GRANULARITIES.map((g) => ({ value: g, label: GRAN_LABEL[g] }));

export function SummaryHeader({
  granularity,
  anchor,
  isToday,
  validating,
  onGranularity,
  onShift,
  onToday,
}: {
  granularity: Granularity;
  anchor: string;
  isToday: boolean;
  /** Идёт перезапрос: старые числа остаются на месте, но помечены «обновляем…» (SWR keepPreviousData). */
  validating: boolean;
  onGranularity: (g: Granularity) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
}) {
  const exportUrl = `/api/summary/export?granularity=${granularity}&date=${anchor}`;
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Сводка по водителям</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Занятость, время и деньги за период — по дате закрытия задач. Цифры кликабельны.
          </p>
        </div>
        <a
          href={exportUrl}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
        >
          Скачать CSV
        </a>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={OPTIONS}
          value={granularity}
          onChange={onGranularity}
          ariaLabel="Разрез периода"
          testIdPrefix="summary-gran"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="h-9 w-9 px-0"
            onClick={() => onShift(-1)}
            aria-label="Предыдущий период"
          >
            ◀
          </Button>
          <span
            data-testid="summary-period"
            className="min-w-44 text-center text-sm font-medium text-neutral-800"
          >
            {formatWindowLabel(granularity, anchor)}
          </span>
          <Button
            variant="secondary"
            className="h-9 w-9 px-0"
            onClick={() => onShift(1)}
            aria-label="Следующий период"
          >
            ▶
          </Button>
          {/* «Сегодня» показываем только когда есть куда возвращаться — иначе кнопка-пустышка. */}
          {!isToday ? (
            <Button variant="secondary" className="h-9" onClick={onToday}>
              Сегодня
            </Button>
          ) : null}
          {validating ? <span className="text-xs text-neutral-400">обновляем…</span> : null}
        </div>
      </div>
    </div>
  );
}
