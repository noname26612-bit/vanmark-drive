"use client";

// «Деньги за период» (v2, вынесено в свой файл в v3): получено vs затраты, каждая строка
// раскрывается списком. Цена простоя, производная от оклада, — ТОЛЬКО админу: диспетчеру сервер
// присылает null, и вместо суммы стоит честная подпись «— для администратора» (решение №10).
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/task-ui";
import { DetailList } from "./detail-list";
import type { Granularity, SummaryDetailMetric, SummaryMoney } from "@/lib/summary-dto";

export function MoneyBlock({
  money: m,
  payrollVisible,
  granularity,
  anchor,
}: {
  money: SummaryMoney;
  payrollVisible: boolean;
  granularity: Granularity;
  anchor: string;
}) {
  const [open, setOpen] = useState<{ metric: SummaryDetailMetric; title: string } | null>(null);
  const toggle = (metric: SummaryDetailMetric, title: string) =>
    setOpen((o) => (o && o.metric === metric ? null : { metric, title }));

  const row = (
    label: string,
    value: string,
    metric: SummaryDetailMetric | null,
    title: string,
    tone: "in" | "out" = "in",
  ) => (
    <button
      type="button"
      disabled={!metric}
      onClick={() => metric && toggle(metric, title)}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-sm",
        metric && "transition-colors hover:bg-neutral-50",
        open && metric === open.metric && "bg-neutral-100",
      )}
    >
      <span className="text-neutral-500">{label}</span>
      <span className={cn("tabular-nums font-medium", tone === "in" ? "text-green-700" : "text-red-700")}>
        {value}
      </span>
    </button>
  );

  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-neutral-900">Деньги за период</h2>
      <div className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Получено</div>
          {row("Оплаты на месте", formatMoney(m.paymentsReceived), "payments", "Полученные оплаты")}
          {row("Расценённые работы", formatMoney(m.pricedWorks), "priced-works", "Расценённые ведомости")}
          <div className="mt-1 flex items-center justify-between border-t border-neutral-100 px-1.5 pt-1.5 text-sm">
            <span className="font-medium text-neutral-800">Итого получено</span>
            <span className="tabular-nums font-semibold text-green-700">{formatMoney(m.receivedTotal)}</span>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Затраты и потери
          </div>
          {row("Внешний перевозчик", formatMoney(m.carrierCost), "carrier", "Поездки внешнего перевозчика", "out")}
          {payrollVisible && m.idleCost != null ? (
            row("Цена простоя (от оклада)", formatMoney(m.idleCost), "shifts", "Смены за период", "out")
          ) : (
            <div className="flex items-center justify-between px-1.5 py-1 text-sm">
              <span className="text-neutral-500">Цена простоя (от оклада)</span>
              <span className="text-neutral-400" title="Доступно администратору">
                — для администратора
              </span>
            </div>
          )}
          {payrollVisible && m.idleNotedCost != null
            ? row("Цена простоя по пометкам", formatMoney(m.idleNotedCost), "idle-notes", "Пометки о простое", "out")
            : null}
        </div>
      </div>
      {open ? (
        <div className="mt-3">
          <DetailList metric={open.metric} title={open.title} granularity={granularity} anchor={anchor} />
        </div>
      ) : null}
    </section>
  );
}
