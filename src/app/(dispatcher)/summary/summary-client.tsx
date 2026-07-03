"use client";

// Сводка v2 (решение Артёма 02.07): аналитика занятости вместо разбивки по типам работ.
// Каждая цифра кликабельна — раскрывает список задач/смен/пометок за ней (lazy, /api/summary/details).
// Рублёвая цена простоя (от оклада) видна только админу — диспетчеру сервер отдаёт null (№10).
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiSend } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { GRANULARITIES, normalizeAnchor, shiftAnchor, formatWindowLabel, type Granularity } from "@/domain/summary";
import type {
  SummaryOverview,
  DriverSummaryView,
  SummaryTotals,
  SummaryMoney,
  SummaryDetailMetric,
  SummaryDetailRow,
  CarrierSummary,
  ShiftHistoryRow,
} from "@/lib/summary-dto";

const GRAN_LABEL: Record<Granularity, string> = { day: "День", week: "Неделя", month: "Месяц" };

/** Минуты → «1 ч 12 мин» / «34 мин» / «—». */
function formatOnSite(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function money(v: number): string {
  return `${v.toLocaleString("ru-RU")} ₽`;
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

// Раскрытая детализация: метрика + необязательный водитель (клик в его карточке).
type OpenDetail = { metric: SummaryDetailMetric; driverId?: string; title: string } | null;

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
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {data.drivers.map((d) => (
              <DriverCard key={d.driverId} driver={d} granularity={granularity} anchor={anchor} />
            ))}
          </div>
          <TotalsBar totals={data.totals} label={label} />
          <MoneyBlock money={data.money} payrollVisible={data.payrollVisible} granularity={granularity} anchor={anchor} />
          <CarrierSection granularity={granularity} anchor={anchor} />
          <ShiftHistorySection granularity={granularity} anchor={anchor} drivers={data.drivers} />
        </>
      )}
    </main>
  );
}

// «HH:MM» из ISO в МСК (учётное время смены).
function shiftTimeHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
}

const SHIFT_STATUS_LABEL: Record<ShiftHistoryRow["status"], string> = {
  REQUESTED: "ждёт подтверждения",
  OPEN: "открыта",
  CLOSED: "закрыта",
};

// История смен за период (№3, 03.07): журнал смен с правкой времени открытия/закрытия прямо здесь.
// Только Д/А (эндпоинт под requireDispatcher). Фильтр по водителю; правка — PATCH /api/shifts/:id.
function ShiftHistorySection({
  granularity,
  anchor,
  drivers,
}: {
  granularity: Granularity;
  anchor: string;
  drivers: DriverSummaryView[];
}) {
  const [driverId, setDriverId] = useState("");
  const key = `/api/summary/shifts?granularity=${granularity}&date=${anchor}${
    driverId ? `&driverId=${driverId}` : ""
  }`;
  const { data: rows = [], isLoading, mutate } = useSWR<ShiftHistoryRow[]>(key, fetcher);

  return (
    <section data-testid="shift-history" className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-neutral-900">История смен</h2>
        <select
          data-testid="shift-history-driver"
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          className="h-9 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-800"
        >
          <option value="">Все водители</option>
          {drivers
            .filter((d) => !d.isExternal)
            .map((d) => (
              <option key={d.driverId} value={d.driverId}>
                {d.driverName}
              </option>
            ))}
        </select>
      </div>
      {isLoading && rows.length === 0 ? (
        <p className="text-sm text-neutral-400">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-500">За этот период смен нет.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <ShiftHistoryItem key={r.id} row={r} onChanged={() => void mutate()} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ShiftHistoryItem({ row, onChanged }: { row: ShiftHistoryRow; onChanged: () => void }) {
  // Инлайн-правка: 'open' | 'close' | null. Время и обязательная причина; сохранение — PATCH /api/shifts/:id.
  const [edit, setEdit] = useState<"open" | "close" | null>(null);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(kind: "open" | "close") {
    setEdit(kind);
    setReason("");
    setError(null);
    setTime(shiftTimeHHMM(kind === "open" ? row.openedAt : (row.closedAt ?? row.openedAt)));
  }

  async function save() {
    if (!reason.trim()) {
      setError("Укажите причину правки");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = edit === "open" ? { openedAtTime: time, reason } : { closedAtTime: time, reason };
      await apiSend(`/api/shifts/${row.id}`, "PATCH", body);
      setEdit(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dateLabel = `${row.dateKey.slice(8)}.${row.dateKey.slice(5, 7)}`;
  return (
    <li className="py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-neutral-800">{row.driverName}</span>
          <span className="ml-2 text-neutral-500">{dateLabel}</span>
          <span className="ml-2 text-xs text-neutral-400">· {SHIFT_STATUS_LABEL[row.status]}</span>
        </div>
        <div className="flex items-center gap-2 text-neutral-600">
          <span>
            Открыта {shiftTimeHHMM(row.openedAt)}
            {row.openedAtAdjustNote ? <span className="ml-1 text-xs text-amber-600">(правлено)</span> : null}
          </span>
          <span className="text-neutral-300">·</span>
          <span>
            {row.closedAt ? `Закрыта ${shiftTimeHHMM(row.closedAt)}` : "не закрыта"}
            {row.closedAtAdjustNote ? <span className="ml-1 text-xs text-amber-600">(правлено)</span> : null}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          data-testid="shift-edit-open"
          onClick={() => startEdit("open")}
          className="rounded px-1.5 py-0.5 text-neutral-500 underline-offset-2 hover:bg-neutral-50 hover:underline"
        >
          Править открытие
        </button>
        {row.closedAt ? (
          <button
            type="button"
            data-testid="shift-edit-close"
            onClick={() => startEdit("close")}
            className="rounded px-1.5 py-0.5 text-neutral-500 underline-offset-2 hover:bg-neutral-50 hover:underline"
          >
            Править закрытие
          </button>
        ) : null}
        {row.shiftMinutes != null ? (
          <span className="text-neutral-400">Длительность {formatOnSite(row.shiftMinutes)}</span>
        ) : null}
      </div>
      {edit ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
          <span className="text-xs font-medium text-neutral-600">
            {edit === "open" ? "Новое время открытия" : "Новое время закрытия"}
          </span>
          <input
            type="time"
            data-testid="shift-edit-time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-8 rounded-md border border-neutral-300 px-2 text-sm"
          />
          <input
            type="text"
            data-testid="shift-edit-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина правки"
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 text-sm"
          />
          <Button
            data-testid="shift-edit-save"
            className="h-8 px-3 text-xs"
            onClick={() => void save()}
            disabled={busy || !time.trim()}
          >
            Сохранить
          </Button>
          <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setEdit(null)} disabled={busy}>
            Отмена
          </Button>
          {error ? <p className="w-full text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Кликабельная цифра-метрика: раскрывает список за ней. 0 — приглушённо. */
function ClickStat({
  label,
  value,
  tone = "muted",
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "warn" | "danger" | "muted";
  active: boolean;
  onClick: () => void;
}) {
  const has = value > 0;
  const dot = !has ? "bg-neutral-300" : tone === "warn" ? "bg-amber-500" : tone === "danger" ? "bg-red-500" : "bg-neutral-400";
  const num = !has ? "text-neutral-400" : tone === "warn" ? "text-amber-700" : tone === "danger" ? "text-red-600" : "text-neutral-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-neutral-50",
        active && "bg-neutral-100",
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      <span className="text-neutral-500">{label}</span>
      <span className={cn("font-medium", num)}>{value}</span>
    </button>
  );
}

/** Мини-график занятости по дням окна: колонка = день, серым — смена, зелёным — отработано. */
function DayLoadChart({ driver }: { driver: DriverSummaryView }) {
  const days = driver.days;
  if (days.length <= 1) return null; // для разреза «день» график не нужен
  const max = Math.max(60, ...days.map((d) => d.shiftMinutes, 0), ...days.map((d) => d.workedMinutes));
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs text-neutral-500">Занятость по дням</div>
      <div className="flex h-14 items-end gap-px">
        {days.map((d) => {
          const shiftPct = Math.round((d.shiftMinutes / max) * 100);
          const workedPct = Math.round((d.workedMinutes / max) * 100);
          const title = `${d.dateKey.slice(8)}.${d.dateKey.slice(5, 7)}: смена ${formatOnSite(d.shiftMinutes)}, в работе ${formatOnSite(d.workedMinutes)}`;
          return (
            <div key={d.dateKey} title={title} className="relative flex-1 self-stretch rounded-sm bg-neutral-50">
              <div
                className="absolute inset-x-0 bottom-0 rounded-sm bg-neutral-200"
                style={{ height: `${shiftPct}%` }}
              />
              <div
                className="absolute inset-x-0 bottom-0 rounded-sm bg-green-500/80"
                style={{ height: `${workedPct}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DriverCard({
  driver,
  granularity,
  anchor,
}: {
  driver: DriverSummaryView;
  granularity: Granularity;
  anchor: string;
}) {
  const [open, setOpen] = useState<OpenDetail>(null);
  const toggle = (metric: SummaryDetailMetric, title: string) =>
    setOpen((o) => (o && o.metric === metric ? null : { metric, driverId: driver.driverId, title }));

  const overPlan =
    driver.planFactCount > 0 && driver.planMinutes > 0
      ? Math.round(((driver.factMinutes - driver.planMinutes) / driver.planMinutes) * 100)
      : null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">
          {driver.driverName}
          {driver.isExternal ? <span className="ml-2 text-xs text-neutral-400">внешний · смен нет</span> : null}
        </span>
        <button
          type="button"
          onClick={() => toggle("done", "Выполненные задачи")}
          className="flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-neutral-50"
        >
          <span className="text-2xl font-semibold text-neutral-900">{driver.doneCount}</span>
          <span className="text-xs text-neutral-500">выполнено</span>
        </button>
      </div>

      {/* Загрузка за период: отработано / длительность смен (штатные). */}
      {!driver.isExternal ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-500">
            <button
              type="button"
              className="rounded px-0.5 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
              onClick={() => toggle("shifts", "Смены за период")}
            >
              Загрузка (от смен, по закрытым)
            </button>
            <span className="font-medium text-neutral-700">
              {driver.loadPercent != null ? `${driver.loadPercent}%` : "смен нет"}
            </span>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded bg-neutral-100">
            <div className="bg-green-500" style={{ width: `${Math.min(100, driver.loadPercent ?? 0)}%` }} />
          </div>
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <ClickStat
          label="Поздние смены"
          value={driver.lateCount}
          tone="warn"
          active={open?.metric === "late"}
          onClick={() => toggle("late", "Поздние открытия смены")}
        />
        <ClickStat
          label="Невып. точки"
          value={driver.missedStopCount}
          tone="danger"
          active={open?.metric === "missed"}
          onClick={() => toggle("missed", "Невыполненные точки")}
        />
        <ClickStat
          label="Отмены"
          value={driver.cancelledCount}
          active={open?.metric === "cancelled"}
          onClick={() => toggle("cancelled", "Отмены")}
        />
        <ClickStat
          label="Переносы"
          value={driver.rescheduledCount}
          active={open?.metric === "rescheduled"}
          onClick={() => toggle("rescheduled", "Переносы")}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-4 border-t border-neutral-100 pt-2.5 text-sm">
        <TimeStat label="На задаче (ср.)" value={formatOnSite(driver.avgOnSiteMinutes)} />
        <TimeStat label="Отработано" value={formatOnSite(driver.workedMinutes)} />
        <button
          type="button"
          onClick={() => toggle("shifts", "Смены за период")}
          className="flex flex-col rounded-md text-left transition-colors hover:bg-neutral-50"
        >
          <span className="text-xs text-neutral-500">Простой</span>
          <span className="font-medium text-neutral-800">{formatOnSite(driver.idleMinutes)}</span>
        </button>
      </div>

      {/* План/факт (v2): по задачам, где есть и оценка, и факт. */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 text-sm">
        <button
          type="button"
          onClick={() => toggle("plan-fact", "План / факт по задачам")}
          className={cn(
            "rounded-md px-1 py-0.5 text-left transition-colors hover:bg-neutral-50",
            open?.metric === "plan-fact" && "bg-neutral-100",
          )}
        >
          <span className="text-neutral-500">План/факт: </span>
          {driver.planFactCount > 0 ? (
            <span className="font-medium text-neutral-800">
              {formatOnSite(driver.planMinutes)} → {formatOnSite(driver.factMinutes)}
              {overPlan != null ? (
                <span className={cn("ml-1", overPlan > 0 ? "text-amber-700" : "text-green-700")}>
                  ({overPlan > 0 ? "+" : ""}
                  {overPlan}%)
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-neutral-400">нет данных</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => toggle("idle-notes", "Пометки о простое")}
          className={cn(
            "rounded-md px-1 py-0.5 text-left transition-colors hover:bg-neutral-50",
            open?.metric === "idle-notes" && "bg-neutral-100",
          )}
        >
          <span className="text-neutral-500">Простой (пометки): </span>
          <span className={cn("font-medium", driver.idleNotedMinutes > 0 ? "text-amber-700" : "text-neutral-400")}>
            {driver.idleNotedMinutes > 0 ? formatOnSite(driver.idleNotedMinutes) : "нет"}
          </span>
        </button>
      </div>

      {!driver.isExternal ? <DayLoadChart driver={driver} /> : null}

      {open ? (
        <DetailList
          metric={open.metric}
          title={open.title}
          granularity={granularity}
          anchor={anchor}
          driverId={open.driverId}
        />
      ) : null}
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

/** Ленивый список за цифрой (drill-down v2). Строки с задачей ведут в её карточку. */
function DetailList({
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
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
      <div className="px-1 pb-1 text-xs font-medium text-neutral-500">{title}</div>
      {isLoading && !data ? (
        <p className="px-1 py-1 text-sm text-neutral-400">Загрузка…</p>
      ) : !data || data.length === 0 ? (
        <p className="px-1 py-1 text-sm text-neutral-400">Пусто за период.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-md bg-white">
          {data.map((r, i) => (
            <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="shrink-0 text-xs text-neutral-400">
                {r.dateKey.slice(8)}.{r.dateKey.slice(5, 7)}
              </span>
              {r.taskId ? (
                <Link href={`/tasks/${r.taskId}`} className="min-w-0 flex-1 truncate font-medium text-neutral-800 hover:underline">
                  {r.number ? `№${r.number} · ` : ""}
                  {r.title}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-neutral-700">{r.title}</span>
              )}
              {!driverId && r.driverName ? (
                <span className="shrink-0 text-xs text-neutral-400">{r.driverName}</span>
              ) : null}
              {r.extra ? <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">{r.extra}</span> : null}
              {r.minutes != null ? (
                <span className="shrink-0 font-medium text-neutral-700">{formatOnSite(r.minutes)}</span>
              ) : null}
              {r.amount != null ? <span className="shrink-0 font-semibold text-neutral-900">{money(r.amount)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TotalsBar({ totals, label }: { totals: SummaryTotals; label: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm">
      <span className="font-medium text-neutral-800">Итого · {label}</span>
      <span className="text-neutral-500">
        выполнено <b className="font-medium text-neutral-800">{totals.doneCount}</b> · загрузка{" "}
        <b className="font-medium text-neutral-800">
          {totals.loadPercent != null ? `${totals.loadPercent}%` : "—"}
        </b>{" "}
        · простой <b className="font-medium text-neutral-800">{formatOnSite(totals.idleMinutes)}</b> · пометки{" "}
        <b className="font-medium text-neutral-800">
          {totals.idleNotedMinutes > 0 ? formatOnSite(totals.idleNotedMinutes) : "—"}
        </b>
      </span>
    </div>
  );
}

/** «Деньги за период» (v2): получено по задачам vs затраты. Цена простоя — только админу (№10). */
function MoneyBlock({
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
  const [open, setOpen] = useState<OpenDetail>(null);
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
      <span className={cn("font-medium", tone === "in" ? "text-green-700" : "text-red-700")}>{value}</span>
    </button>
  );
  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-neutral-900">Деньги за период</h2>
      <div className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Получено</div>
          {row("Оплаты на месте", money(m.paymentsReceived), "payments", "Полученные оплаты")}
          {row("Расценённые работы", money(m.pricedWorks), "priced-works", "Расценённые ведомости")}
          <div className="mt-1 flex items-center justify-between border-t border-neutral-100 px-1.5 pt-1.5 text-sm">
            <span className="font-medium text-neutral-800">Итого получено</span>
            <span className="font-semibold text-green-700">{money(m.receivedTotal)}</span>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Затраты и потери</div>
          {row("Внешний перевозчик", money(m.carrierCost), "carrier", "Поездки внешнего перевозчика", "out")}
          {payrollVisible && m.idleCost != null ? (
            row("Цена простоя (от оклада)", money(m.idleCost), "shifts", "Смены за период", "out")
          ) : (
            <div className="flex items-center justify-between px-1.5 py-1 text-sm">
              <span className="text-neutral-500">Цена простоя (от оклада)</span>
              <span className="text-neutral-400" title="Доступно администратору">
                — для администратора
              </span>
            </div>
          )}
          {payrollVisible && m.idleNotedCost != null
            ? row("Цена простоя по пометкам", money(m.idleNotedCost), "idle-notes", "Пометки о простое", "out")
            : null}
        </div>
      </div>
      {open ? <DetailList metric={open.metric} title={open.title} granularity={granularity} anchor={anchor} /> : null}
    </section>
  );
}

/** Затраты на внешнего перевозчика за период (этап 3, 02.07): сумма/кол-во/средняя + список задач + CSV.
 *  Секция скрыта, если завершённых задач внешних исполнителей в окне нет. */
function CarrierSection({ granularity, anchor }: { granularity: Granularity; anchor: string }) {
  const { data } = useSWR<CarrierSummary>(
    `/api/summary/carrier?granularity=${granularity}&date=${anchor}`,
    fetcher,
  );
  const [open, setOpen] = useState(false);
  if (!data || data.taskCount === 0) return null;
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
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-2xl font-semibold text-neutral-900">{money(data.totalCost)}</div>
          <div className="text-xs text-neutral-500">затраты за период</div>
        </div>
        <div>
          <div className="text-2xl font-semibold text-neutral-900">{data.taskCount}</div>
          <div className="text-xs text-neutral-500">{plural(data.taskCount, ["задача", "задачи", "задач"])}</div>
        </div>
        <div>
          <div className="text-2xl font-semibold text-neutral-900">{data.avgCost != null ? money(data.avgCost) : "—"}</div>
          <div className="text-xs text-neutral-500">средняя стоимость</div>
        </div>
      </div>
      {data.pricedCount < data.taskCount ? (
        <p className="mt-2 text-xs text-amber-700">
          У {data.taskCount - data.pricedCount} {plural(data.taskCount - data.pricedCount, ["задачи", "задач", "задач"])} стоимость не проставлена — сумма неполная.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-sm font-medium text-neutral-600 underline-offset-2 hover:underline"
      >
        {open ? "Скрыть задачи" : `Показать задачи (${data.taskCount})`}
      </button>
      {open ? (
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {data.tasks.map((t) => (
            <li key={t.taskId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="text-neutral-500">
                {t.dateKey.slice(8)}.{t.dateKey.slice(5, 7)}
              </span>
              <a href={`/tasks/${t.taskId}`} className="min-w-0 flex-1 truncate font-medium text-neutral-800 hover:underline">
                №{t.number} · {t.title}
              </a>
              <span className="font-semibold text-neutral-900">{t.cost != null ? money(t.cost) : "—"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
