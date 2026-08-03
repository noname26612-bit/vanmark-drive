"use client";

// Панель закрытия / правки закрытия смены (03.08). Одна реализация на три места: строка смены на
// доске «Сегодня», блок зависших смен и «История смен» в KPI.
//
// Главное отличие от прежней инлайн-панели — ДАТА закрытия. Раньше время жёстко привязывалось ко дню
// смены, поэтому смену через полночь («выехал в 22:00, вернулся в 02:15») и забытую смену прошлого
// дня нельзя было закрыть правильно. Живой расчёт длительности показывает опечатку в дате до отправки.
import { useState } from "react";
import { apiSend } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";

/** «HH:MM» из ISO в МСК — учётное время смены. */
export function shiftHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
}

/** Минуты → «11 ч 30 мин». */
function formatSpan(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function ShiftClosePanel({
  shiftId,
  driverName,
  shiftDate,
  openedAt,
  closedAt,
  mode,
  allowCloseNow,
  onDone,
  onCancel,
}: {
  shiftId: string;
  driverName: string;
  shiftDate: string; // YYYY-MM-DD — день смены
  openedAt: string; // ISO
  closedAt?: string | null; // ISO, для режима правки
  mode: "close" | "adjust";
  allowCloseNow: boolean;
  onDone: () => Promise<unknown> | void;
  onCancel: () => void;
}) {
  // Для зависшей смены время не подставляем: Милена должна ввести его осознанно, а не «подтвердить»
  // случайное значение. Для сегодняшней — текущее время, как было раньше.
  const [date, setDate] = useState(
    mode === "adjust" && closedAt ? new Date(closedAt).toISOString().slice(0, 10) : shiftDate,
  );
  const [time, setTime] = useState(
    mode === "adjust" && closedAt ? shiftHHMM(closedAt) : allowCloseNow ? shiftHHMM(new Date().toISOString()) : "",
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Сколько получится смена с введёнными датой и временем — опечатка в дате видна сразу.
  const spanMinutes = (() => {
    if (!/^\d{2}:\d{2}$/.test(time) || !date) return null;
    const end = new Date(`${date}T${time}:00.000+03:00`).getTime();
    const start = new Date(openedAt).getTime();
    if (Number.isNaN(end)) return null;
    return Math.round((end - start) / 60000);
  })();

  async function send(withTime: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> =
        mode === "adjust"
          ? { closedAtDate: date, closedAtTime: time, reason }
          : withTime
            ? { op: "close", closedAtDate: date, closedAtTime: time, reason }
            : { op: "close" };
      await apiSend(`/api/shifts/${shiftId}`, "PATCH", body);
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "adjust" ? `Правка закрытия — ${driverName}` : `Закрыть смену — ${driverName}`;
  return (
    <div
      data-testid="shift-close-panel"
      className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"
    >
      <p className="mb-2 font-medium text-slate-700">{title}</p>
      {allowCloseNow ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            data-testid="shift-close-now"
            className="h-8 px-3 text-xs"
            onClick={() => void send(false)}
            disabled={busy}
          >
            Закрыть сейчас
          </Button>
          <Button variant="ghost" className="h-8 px-3 text-xs" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <DateField value={date} onChange={setDate} testId="shift-close-date" className="w-40" />
        <input
          type="time"
          data-testid="shift-close-time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="h-8 rounded-md border border-slate-300 px-2"
        />
        <input
          type="text"
          data-testid="shift-close-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина (напр. «водитель забыл закрыть»)"
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2"
        />
        <Button
          data-testid="shift-close-save"
          variant="secondary"
          className="h-8 px-3 text-xs"
          onClick={() => void send(true)}
          disabled={busy || !time.trim()}
        >
          {mode === "adjust" ? "Сохранить" : "Закрыть указанным"}
        </Button>
        {!allowCloseNow ? (
          <Button variant="ghost" className="h-8 px-3 text-xs" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
        ) : null}
      </div>
      {spanMinutes !== null ? (
        <p
          data-testid="shift-close-span"
          className={`mt-1.5 ${spanMinutes <= 0 || spanMinutes > 24 * 60 ? "text-red-600" : "text-slate-500"}`}
        >
          {spanMinutes <= 0
            ? "Закрытие раньше открытия — проверьте дату и время"
            : `Смена получится ${formatSpan(spanMinutes)}`}
        </p>
      ) : null}
      {error ? <p className="mt-1 text-red-600">{error}</p> : null}
    </div>
  );
}
