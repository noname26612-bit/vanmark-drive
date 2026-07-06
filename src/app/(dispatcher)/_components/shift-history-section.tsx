"use client";

// «История смен» за окно периода (№3, 03.07): журнал смен с правкой времени открытия/закрытия
// прямо здесь. Только Д/А (эндпоинт под requireDispatcher). Фильтр по водителю; правка —
// PATCH /api/shifts/:id. С 06.07 живёт в «KPI / Зарплата» (перенесена из «Сводки»).
import { useState } from "react";
import useSWR from "swr";
import { Pencil } from "lucide-react";
import { fetcher, apiSend } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import type { ShiftHistoryRow } from "@/lib/summary-dto";
import type { Granularity } from "@/domain/summary";

/** Водитель для фильтра истории (только нужные поля). */
export type ShiftHistoryDriver = { driverId: string; driverName: string };

/** Минуты → «1 ч 12 мин» / «34 мин» / «—». */
function formatDuration(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
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

export function ShiftHistorySection({
  granularity,
  anchor,
  drivers,
}: {
  granularity: Granularity;
  anchor: string;
  drivers: ShiftHistoryDriver[];
}) {
  const [driverId, setDriverId] = useState("");
  const key = `/api/summary/shifts?granularity=${granularity}&date=${anchor}${
    driverId ? `&driverId=${driverId}` : ""
  }`;
  const { data: rows = [], isLoading, mutate } = useSWR<ShiftHistoryRow[]>(key, fetcher);

  return (
    <section data-testid="shift-history" className="mt-8 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-neutral-900">История смен</h2>
        <select
          data-testid="shift-history-driver"
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          className="h-9 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-800"
        >
          <option value="">Все водители</option>
          {drivers.map((d) => (
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
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          data-testid="shift-edit-open"
          onClick={() => startEdit("open")}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1 font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
        >
          <Pencil className="h-3.5 w-3.5" /> Править открытие
        </button>
        {row.closedAt ? (
          <button
            type="button"
            data-testid="shift-edit-close"
            onClick={() => startEdit("close")}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1 font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
          >
            <Pencil className="h-3.5 w-3.5" /> Править закрытие
          </button>
        ) : null}
        {row.shiftMinutes != null ? (
          <span className="text-neutral-400">Длительность {formatDuration(row.shiftMinutes)}</span>
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
