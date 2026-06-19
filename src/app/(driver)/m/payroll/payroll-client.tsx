"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { formatMoney, formatDate, formatPeriod, shiftPeriod } from "@/lib/task-ui";
import { KPI_KIND_LABEL, KPI_KIND_BADGE, actBonusSummary } from "@/lib/kpi-dto";
import type { DriverPayrollView } from "@/lib/kpi-dto";
import { Badge } from "@/components/ui/badge";

export function DriverPayrollClient({ initialPeriod }: { initialPeriod: string }) {
  const [period, setPeriod] = useState(initialPeriod);
  const { data, isLoading, error } = useSWR<DriverPayrollView>(`/api/my/kpi?period=${period}`, fetcher);

  return (
    <main className="px-3 pb-10 pt-3">
      <Link href="/m" className="text-sm text-neutral-500">
        ← Мои задачи
      </Link>
      <h1 className="mt-2 text-xl font-bold text-neutral-900">Мой расчёт</h1>

      {/* Переключатель месяца — крупные тач-цели */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPeriod(shiftPeriod(period, -1))}
          aria-label="Предыдущий месяц"
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-300 text-lg text-neutral-700"
        >
          ◀
        </button>
        <span className="text-base font-semibold text-neutral-900">{formatPeriod(period)}</span>
        <button
          type="button"
          onClick={() => setPeriod(shiftPeriod(period, 1))}
          aria-label="Следующий месяц"
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-300 text-lg text-neutral-700"
        >
          ▶
        </button>
      </div>

      {error ? (
        <p className="mt-6 rounded-lg bg-red-50 px-3 py-4 text-base text-red-700">Не удалось загрузить расчёт.</p>
      ) : isLoading && !data ? (
        <p className="mt-10 text-center text-base text-neutral-400">Загрузка…</p>
      ) : data ? (
        <PayrollBody data={data} />
      ) : null}
    </main>
  );
}

function PayrollBody({ data }: { data: DriverPayrollView }) {
  const amountByMark = new Map(data.breakdown.map((b) => [b.markId, b.amount]));

  return (
    <>
      {/* Итог — крупно */}
      <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-900 p-5 text-white">
        <p className="text-sm text-neutral-300">К выплате</p>
        <p className="mt-1 text-3xl font-bold">{formatMoney(data.total)}</p>
        {data.closed ? (
          <span className="mt-2 inline-block rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-300">
            Месяц закрыт
          </span>
        ) : (
          <span className="mt-2 inline-block text-xs text-neutral-400">Предварительно (месяц не закрыт)</span>
        )}
      </div>

      {/* Разбивка */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-neutral-200 p-4 text-base">
        <span className="text-neutral-600">Оклад</span>
        <span className="text-right text-neutral-900">{formatMoney(data.baseSalary)}</span>
        <span className="text-neutral-600">Премия</span>
        <span className="text-right text-neutral-900">{formatMoney(data.premiumBase)}</span>
        <span className="text-neutral-600">Штрафы</span>
        <span className={`text-right ${data.penalty > 0 ? "text-red-600" : "text-neutral-900"}`}>
          {data.penalty > 0 ? `−${formatMoney(data.penalty)}` : "—"}
        </span>
        {data.bonus > 0 ? (
          <>
            <span className="text-neutral-600">Поощрения</span>
            <span className="text-right text-green-700">+{formatMoney(data.bonus)}</span>
          </>
        ) : null}
        {data.actBonus.value > 0 ? (
          <>
            <span className="text-neutral-600">Бонус за акты</span>
            <span className="text-right text-green-700">+{formatMoney(data.actBonus.value)}</span>
          </>
        ) : null}
      </div>

      {/* Прогресс бонуса за комплектность актов (этап 15, PRD §12.6) */}
      {data.actBonus.base > 0 || data.actBonus.value > 0 ? <ActBonusNote data={data} /> : null}

      {/* Мои нарушения и отметки */}
      <h2 className="mt-6 px-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Мои нарушения за месяц
      </h2>
      {data.marks.length === 0 ? (
        <p className="mt-2 rounded-xl border border-neutral-200 p-4 text-base text-neutral-500">
          Нарушений нет — полная премия 🎉
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {data.marks.map((m) => {
            const amount = amountByMark.get(m.id);
            return (
              <li key={m.id} className="rounded-xl border border-neutral-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge className={KPI_KIND_BADGE[m.kind]}>{KPI_KIND_LABEL[m.kind]}</Badge>
                  {amount != null ? (
                    <span className={amount >= 0 ? "font-semibold text-green-700" : "font-semibold text-red-600"}>
                      {amount >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(amount))}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
                  <span>{formatDate(m.occurredAt)}</span>
                  {m.taskNumber ? <span>· №{m.taskNumber}</span> : null}
                </div>
                {m.note ? <p className="mt-0.5 text-sm text-neutral-600">{m.note}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ActBonusNote({ data }: { data: DriverPayrollView }) {
  const s = actBonusSummary(data.actBonus);
  const tone =
    s.tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : s.tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-neutral-200 bg-neutral-50 text-neutral-600";
  return <p className={`mt-3 rounded-xl border px-3 py-3 text-sm font-medium ${tone}`}>{s.text}</p>;
}
