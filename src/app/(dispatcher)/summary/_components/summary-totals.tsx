"use client";

// «Итого за период» (Сводка v3): картина целиком — ДО таблицы по водителям.
// До сих пор итоги стояли под карточками и показывали 4 поля из 13; сравнить период с прошлым было
// нечем, и «выполнено 12» ничего не значило само по себе.
//
// Сравнение подаётся НЕЙТРАЛЬНО — «было N», графитом, без зелёного и красного (решение 22.08.2026):
// текущий период почти всегда неполный (сегодняшний день, начатая неделя), и красить падение в
// «плохо» — врать. Цвет в проекте значит смысл, а не направление.
import { StatTile } from "@/components/ui/stat-tile";
import { formatDuration } from "@/lib/format-duration";
import { formatMoney } from "@/lib/task-ui";
import type { SummaryMoney, SummaryTotals } from "@/lib/summary-dto";

export function SummaryTotalsBlock({
  totals,
  money,
  payrollVisible,
  prevTotals,
  prevMoney,
}: {
  totals: SummaryTotals;
  money: SummaryMoney;
  payrollVisible: boolean;
  /** Итоги предыдущего периода того же разреза; null — ещё грузятся или не удалось получить. */
  prevTotals: SummaryTotals | null;
  prevMoney: SummaryMoney | null;
}) {
  const was = (v: string | number | null | undefined): string | null =>
    v === null || v === undefined ? null : `было ${v}`;

  return (
    <section className="mt-5" data-testid="summary-totals">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Итого за период
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Выполнено"
          value={totals.doneCount}
          hint={was(prevTotals?.doneCount)}
          testId="totals-done"
        />
        <StatTile
          label="Загрузка"
          value={totals.loadPercent != null ? `${totals.loadPercent}%` : "—"}
          hint={was(prevTotals?.loadPercent != null ? `${prevTotals.loadPercent}%` : null)}
          testId="totals-load"
        />
        <StatTile
          label="Отработано"
          value={formatDuration(totals.workedMinutes)}
          hint={was(prevTotals ? formatDuration(prevTotals.workedMinutes) : null)}
          testId="totals-worked"
        />
        <StatTile
          label="Простой"
          value={formatDuration(totals.idleMinutes)}
          hint={was(prevTotals ? formatDuration(prevTotals.idleMinutes) : null)}
          testId="totals-idle"
        />
        <StatTile
          label="Простой (пометки)"
          value={totals.idleNotedMinutes > 0 ? formatDuration(totals.idleNotedMinutes) : "—"}
          hint={was(
            prevTotals ? (prevTotals.idleNotedMinutes > 0 ? formatDuration(prevTotals.idleNotedMinutes) : "—") : null,
          )}
          tone={totals.idleNotedMinutes > 0 ? "amber" : "muted"}
          testId="totals-idle-noted"
        />
        <StatTile
          label="Поздние смены"
          value={totals.lateCount}
          hint={was(prevTotals?.lateCount)}
          tone={totals.lateCount > 0 ? "amber" : "muted"}
          testId="totals-late"
        />
        <StatTile
          label="Невып. точки"
          value={totals.missedStopCount}
          hint={was(prevTotals?.missedStopCount)}
          tone={totals.missedStopCount > 0 ? "red" : "muted"}
          testId="totals-missed"
        />
        <StatTile
          label="Отмены / переносы"
          value={`${totals.cancelledCount} / ${totals.rescheduledCount}`}
          hint={was(prevTotals ? `${prevTotals.cancelledCount} / ${prevTotals.rescheduledCount}` : null)}
          testId="totals-cancel-reschedule"
        />
        <StatTile
          label="Получено"
          value={formatMoney(money.receivedTotal)}
          hint={was(prevMoney ? formatMoney(prevMoney.receivedTotal) : null)}
          tone="green"
          testId="totals-received"
        />
        {/* Затраты: перевозчик всем, цена простоя от оклада — только админу (№10). */}
        <StatTile
          label={payrollVisible ? "Затраты (перевозчик + простой)" : "Затраты (перевозчик)"}
          value={formatMoney(money.carrierCost + (money.idleCost ?? 0))}
          hint={was(
            prevMoney ? formatMoney(prevMoney.carrierCost + (prevMoney.idleCost ?? 0)) : null,
          )}
          tone="red"
          testId="totals-costs"
        />
      </div>
    </section>
  );
}
