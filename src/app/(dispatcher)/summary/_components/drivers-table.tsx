"use client";

// Таблица-сравнение водителей (Сводка v3, решение Артёма 22.08.2026).
//
// БЫЛО: карточка на водителя, в ней 14 метрик мелким текстом. Чтобы понять, кто из двоих
// недозагружен, приходилось водить глазами между карточками и искать одинаковые подписи.
// СТАЛО: строка = водитель, столбец = метрика. Одна колонка — один вопрос, сравнение бесплатно.
//
// Каждая цифра — кнопка: клик раскрывает под строкой график по дням и список за этой цифрой.
import { Fragment, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LoadBar } from "@/components/ui/load-bar";
import { formatDuration } from "@/lib/format-duration";
import { DriverDetails } from "./driver-details";
import type { DriverSummaryView, Granularity, SummaryDetailMetric } from "@/lib/summary-dto";

type Open = { driverId: string; metric: SummaryDetailMetric; title: string } | null;

export function DriversTable({
  drivers,
  granularity,
  anchor,
  workdayMinutes,
}: {
  drivers: DriverSummaryView[];
  granularity: Granularity;
  anchor: string;
  workdayMinutes: number;
}) {
  const [open, setOpen] = useState<Open>(null);
  const toggle = (driverId: string, metric: SummaryDetailMetric, title: string) =>
    setOpen((o) => (o && o.driverId === driverId && o.metric === metric ? null : { driverId, metric, title }));

  // Колонок 12; раскрытая панель занимает всю ширину строки.
  const colSpan = 12;

  return (
    <section className="mt-5 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[64rem] text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs text-neutral-400">
          <tr>
            <th className="sticky left-0 z-10 bg-white px-3 py-2">Водитель</th>
            <th className="px-3 py-2">Выполнено</th>
            <th className="min-w-40 px-3 py-2">Загрузка</th>
            <th className="px-3 py-2">Отработано</th>
            <th className="px-3 py-2">Простой</th>
            <th className="px-3 py-2">На задаче</th>
            <th className="px-3 py-2">Поздние</th>
            <th className="px-3 py-2">Невып.</th>
            <th className="px-3 py-2">Отмены</th>
            <th className="px-3 py-2">Переносы</th>
            <th className="px-3 py-2">План→факт</th>
            <th className="px-3 py-2">Простой (пометки)</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => {
            const expanded = open?.driverId === d.driverId ? open : null;
            const overPlan =
              d.planFactCount > 0 && d.planMinutes > 0
                ? Math.round(((d.factMinutes - d.planMinutes) / d.planMinutes) * 100)
                : null;
            return (
              <Fragment key={d.driverId}>
                <tr
                  data-testid={`summary-row-${d.driverId}`}
                  className="border-b border-neutral-100 last:border-0 align-middle"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-neutral-900"
                  >
                    {d.driverName}
                    {d.isExternal ? (
                      <span className="ml-2 text-xs font-normal text-neutral-400">внешний · смен нет</span>
                    ) : null}
                  </th>

                  <td className="px-3 py-2">
                    <MetricButton
                      ariaLabel={`выполнено ${d.doneCount}`}
                      testId="summary-done"
                      active={expanded?.metric === "done"}
                      onClick={() => toggle(d.driverId, "done", "Выполненные задачи")}
                    >
                      <span className="text-base font-semibold tabular-nums text-neutral-900">
                        {d.doneCount}
                      </span>
                      {d.pairDoneCount > 0 ? (
                        <span data-testid="summary-pair-done" className="ml-1 text-xs text-neutral-400">
                          +{d.pairDoneCount} в паре
                        </span>
                      ) : null}
                    </MetricButton>
                  </td>

                  {/* Загрузка: процент и полоса с легендой. У внешнего перевозчика смен нет — прочерк. */}
                  <td className="px-3 py-2">
                    {d.isExternal ? (
                      <span className="text-neutral-300">—</span>
                    ) : (
                      <MetricButton
                        ariaLabel={`загрузка ${d.loadPercent ?? 0}`}
                        testId="summary-load"
                        active={expanded?.metric === "shifts"}
                        onClick={() => toggle(d.driverId, "shifts", "Смены за период")}
                        className="w-full"
                      >
                        <span className="block w-full">
                          {d.loadPercent != null ? (
                            <>
                              <span className="mb-0.5 block text-xs tabular-nums font-medium text-neutral-700">
                                {d.loadPercent}%
                              </span>
                              <LoadBar
                                percent={d.loadPercent}
                                workedMinutes={d.workedMinutes}
                                idleMinutes={d.idleMinutes}
                              />
                            </>
                          ) : (
                            // Смен в периоде не было: полосу не рисуем вовсе — пустая шкала читалась
                            // бы как «работы ноль», хотя работать было негде.
                            <span className="text-xs text-neutral-400">смен нет</span>
                          )}
                        </span>
                      </MetricButton>
                    )}
                  </td>

                  <td className="px-3 py-2 tabular-nums text-neutral-700">
                    {formatDuration(d.workedMinutes)}
                  </td>

                  <td className="px-3 py-2">
                    <MetricButton
                      ariaLabel={`простой ${d.idleMinutes}`}
                      active={expanded?.metric === "shifts"}
                      onClick={() => toggle(d.driverId, "shifts", "Смены за период")}
                    >
                      <span className="tabular-nums text-neutral-700">{formatDuration(d.idleMinutes)}</span>
                    </MetricButton>
                  </td>

                  <td className="px-3 py-2 tabular-nums text-neutral-700">
                    {formatDuration(d.avgOnSiteMinutes)}
                  </td>

                  <CountCell
                    value={d.lateCount}
                    tone="amber"
                    ariaLabel={`поздние смены ${d.lateCount}`}
                    active={expanded?.metric === "late"}
                    onClick={() => toggle(d.driverId, "late", "Поздние открытия смены")}
                  />
                  <CountCell
                    value={d.missedStopCount}
                    tone="red"
                    ariaLabel={`невыполненные точки ${d.missedStopCount}`}
                    active={expanded?.metric === "missed"}
                    onClick={() => toggle(d.driverId, "missed", "Невыполненные точки")}
                  />
                  <CountCell
                    value={d.cancelledCount}
                    ariaLabel={`отмены ${d.cancelledCount}`}
                    active={expanded?.metric === "cancelled"}
                    onClick={() => toggle(d.driverId, "cancelled", "Отмены")}
                  />
                  <CountCell
                    value={d.rescheduledCount}
                    ariaLabel={`переносы ${d.rescheduledCount}`}
                    active={expanded?.metric === "rescheduled"}
                    onClick={() => toggle(d.driverId, "rescheduled", "Переносы")}
                  />

                  <td className="px-3 py-2">
                    <MetricButton
                      ariaLabel={`план и факт ${d.planFactCount}`}
                      active={expanded?.metric === "plan-fact"}
                      onClick={() => toggle(d.driverId, "plan-fact", "План / факт по задачам")}
                    >
                      {d.planFactCount > 0 ? (
                        <span className="tabular-nums text-neutral-700">
                          {formatDuration(d.planMinutes)} → {formatDuration(d.factMinutes)}
                          {overPlan != null ? (
                            <span className="ml-1 text-xs text-neutral-500">
                              ({overPlan > 0 ? "+" : ""}
                              {overPlan}%)
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </MetricButton>
                  </td>

                  <td className="px-3 py-2">
                    <MetricButton
                      ariaLabel={`пометки простоя ${d.idleNotedMinutes}`}
                      active={expanded?.metric === "idle-notes"}
                      onClick={() => toggle(d.driverId, "idle-notes", "Пометки о простое")}
                    >
                      <span
                        className={cn(
                          "tabular-nums",
                          d.idleNotedMinutes > 0 ? "text-amber-700" : "text-neutral-300",
                        )}
                      >
                        {d.idleNotedMinutes > 0 ? formatDuration(d.idleNotedMinutes) : "—"}
                      </span>
                    </MetricButton>
                  </td>
                </tr>

                {expanded ? (
                  <tr className="border-b border-neutral-100 bg-neutral-50">
                    <td colSpan={colSpan} className="px-3 py-3">
                      <DriverDetails
                        driver={d}
                        metric={expanded.metric}
                        title={expanded.title}
                        granularity={granularity}
                        anchor={anchor}
                        workdayMinutes={workdayMinutes}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Ячейка-счётчик: 0 приглушён, ненулевое красится по смыслу (янтарь — внимание, красный — сорвано). */
function CountCell({
  value,
  tone = "neutral",
  ariaLabel,
  active,
  onClick,
}: {
  value: number;
  tone?: "neutral" | "amber" | "red";
  ariaLabel: string;
  active?: boolean;
  onClick: () => void;
}) {
  const cls =
    value === 0
      ? "text-neutral-300"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "red"
          ? "text-red-600"
          : "text-neutral-700";
  return (
    <td className="px-3 py-2">
      <MetricButton ariaLabel={ariaLabel} active={active} onClick={onClick}>
        <span className={cn("font-medium tabular-nums", cls)}>{value}</span>
      </MetricButton>
    </td>
  );
}

/** Цифра-кнопка: раскрывает подробности под строкой. aria-label несёт метрику и значение. */
function MetricButton({
  ariaLabel,
  testId,
  active,
  onClick,
  className,
  children,
}: {
  ariaLabel: string;
  testId?: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={!!active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "rounded-md px-1.5 py-1 text-left transition-colors hover:bg-neutral-100",
        active && "bg-neutral-100",
        className,
      )}
    >
      {children}
    </button>
  );
}
