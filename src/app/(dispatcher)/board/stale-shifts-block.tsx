"use client";

// Незакрытые смены прошлых дней (03.08). Водитель забыл нажать «Закрыть смену», день прошёл:
// смена выпадает из Сводки и зарплаты, а доска показывает только сегодняшний день — раньше такую
// смену вообще нельзя было увидеть и закрыть. Янтарная плашка = требует действия сейчас
// (ui-guidelines). Закрывает диспетчер/директор/админ, указывая дату и время.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { ShiftClosePanel, shiftHHMM } from "../_components/shift-close-panel";

// Ответ /api/shifts/stale — нужен минимум полей (полный ShiftView шире).
type StaleShift = {
  id: string;
  driverId: string;
  driverName: string | null;
  date: string; // YYYY-MM-DD — день смены
  openedAt: string;
};

/** «дд.мм» из YYYY-MM-DD. */
function dayLabel(dateKey: string): string {
  return `${dateKey.slice(8)}.${dateKey.slice(5, 7)}`;
}

/** Сколько уже идёт смена — «идёт 27 ч». */
function runningFor(openedAt: string, now: number): string {
  const hours = Math.floor((now - new Date(openedAt).getTime()) / 3_600_000);
  if (hours < 1) return "меньше часа";
  return `${hours} ч`;
}

export function StaleShiftsBlock({ onChanged }: { onChanged: () => Promise<unknown> | void }) {
  const { data: shifts = [], mutate } = useSWR<StaleShift[]>("/api/shifts/stale", fetcher, {
    refreshInterval: 60_000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  // «Идёт N ч» тикает раз в минуту (как полоса смены на доске) — Date.now() в рендере нечист.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (shifts.length === 0) return null;

  return (
    <section
      data-testid="stale-shifts-block"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3"
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
        <AlertTriangle className="h-4 w-4" />
        Незакрытые смены прошлых дней — {shifts.length}
      </h2>
      <p className="mb-2 text-xs text-amber-700">
        Водитель не закрыл смену. Пока она открыта, день не попадает в сводку и расчёт.
      </p>
      <ul className="space-y-2">
        {shifts.map((s) => (
          <li
            key={s.id}
            data-testid="stale-shift-row"
            className="rounded-lg border border-amber-200 bg-white px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-neutral-800">
                <span className="font-medium">{s.driverName ?? "—"}</span>
                <span className="text-neutral-500">
                  {" "}
                  · смена за {dayLabel(s.date)} · открыта в {shiftHHMM(s.openedAt)} · идёт{" "}
                  {runningFor(s.openedAt, now)}
                </span>
              </span>
              <Button
                data-testid="stale-shift-close"
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
              >
                Закрыть смену
              </Button>
            </div>
            {openId === s.id ? (
              <ShiftClosePanel
                shiftId={s.id}
                driverName={s.driverName ?? "—"}
                shiftDate={s.date}
                openedAt={s.openedAt}
                mode="close"
                allowCloseNow={false}
                onDone={async () => {
                  setOpenId(null);
                  await mutate();
                  await onChanged();
                }}
                onCancel={() => setOpenId(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
