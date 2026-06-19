"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import { formatMinutes } from "@/domain/capacity";
import type { TaskDTO } from "@/lib/task-dto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const HORIZON_DAYS = 14; // 2 недели (PRD §14.4)

type Spec = "REPAIR" | "DELIVERY" | "ANY";
type Cell = { minutes: number; count: number };
type Calendar = {
  workdayMinutes: number;
  days: string[];
  drivers: { id: string; name: string; specialization: Spec }[];
  cells: Record<string, Record<string, Cell>>;
};

const SPEC_LABEL: Record<Spec, string> = { REPAIR: "Ремонты", DELIVERY: "Доставки", ANY: "Любые" };
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// День недели и «ДД.ММ» по дате-ключу (parse как UTC, чтобы не было сдвига).
function dayMeta(key: string): { weekday: number; label: string } {
  const d = new Date(`${key}T00:00:00.000Z`);
  return { weekday: d.getUTCDay(), label: `${key.slice(8, 10)}.${key.slice(5, 7)}` };
}
function isWeekend(key: string): boolean {
  const w = dayMeta(key).weekday;
  return w === 0 || w === 6;
}

// Цвет ячейки по доле загрузки от рабочего дня (PRD §14.4).
function loadClass(cell: Cell, workday: number): string {
  if (cell.count === 0) return "bg-white text-neutral-300";
  const pct = workday > 0 ? cell.minutes / workday : 0;
  if (pct > 1) return "bg-red-100 text-red-800";
  if (pct >= 0.7) return "bg-amber-100 text-amber-800";
  return "bg-green-100 text-green-800";
}

export function CapacityCalendarClient() {
  const [offset, setOffset] = useState(0); // сдвиг окна в днях (± HORIZON_DAYS)
  const base = new Date();
  base.setDate(base.getDate() + offset);
  const from = localKey(base);
  const toDate = new Date(base);
  toDate.setDate(toDate.getDate() + HORIZON_DAYS - 1);
  const to = localKey(toDate);

  const { data, isLoading } = useSWR<Calendar>(
    `/api/capacity/calendar?from=${from}&to=${to}`,
    fetcher,
    { refreshInterval: 30_000, keepPreviousData: true },
  );

  const [sel, setSel] = useState<{ driverId: string; driverName: string; day: string } | null>(null);

  return (
    <main className="mx-auto max-w-6xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Календарь загрузки</h1>
          <p className="text-sm text-neutral-500">
            Оценка занятости водителей по дням (работа + дорога). Подсказка для планирования — ничего не блокирует.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setOffset((o) => o - HORIZON_DAYS)}>
            ‹ Раньше
          </Button>
          <Button variant="secondary" onClick={() => setOffset(0)} disabled={offset === 0}>
            Сегодня
          </Button>
          <Button variant="secondary" onClick={() => setOffset((o) => o + HORIZON_DAYS)}>
            Позже ›
          </Button>
        </div>
      </div>

      {/* Легенда */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-green-100" /> свободно (&lt;70%)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-amber-100" /> плотно (70–100%)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-red-100" /> перегруз (&gt;100%)
        </span>
        {data ? <span>· рабочий день {formatMinutes(data.workdayMinutes)}</span> : null}
      </div>

      {isLoading && !data ? (
        <p className="mt-6 text-sm text-neutral-400">Загрузка…</p>
      ) : !data || data.drivers.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">Нет активных водителей.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full border-collapse text-sm" data-testid="capacity-grid">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-medium text-neutral-400">
                  Водитель
                </th>
                {data.days.map((day) => {
                  const m = dayMeta(day);
                  return (
                    <th
                      key={day}
                      className={`px-2 py-2 text-center text-xs font-medium ${
                        isWeekend(day) ? "bg-neutral-50 text-neutral-400" : "text-neutral-500"
                      }`}
                    >
                      <div>{WEEKDAYS[m.weekday]}</div>
                      <div className="font-normal">{m.label}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.drivers.map((d) => (
                <tr key={d.id} className="border-b border-neutral-100 last:border-0">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-neutral-800">
                    <div>{d.name}</div>
                    {d.specialization !== "ANY" ? (
                      <Badge className="mt-0.5 bg-neutral-100 text-neutral-500">{SPEC_LABEL[d.specialization]}</Badge>
                    ) : null}
                  </th>
                  {data.days.map((day) => {
                    const cell = data.cells[d.id]?.[day] ?? { minutes: 0, count: 0 };
                    return (
                      <td key={day} className="p-1 text-center">
                        <button
                          type="button"
                          disabled={cell.count === 0}
                          onClick={() => setSel({ driverId: d.id, driverName: d.name, day })}
                          className={`flex h-12 w-full flex-col items-center justify-center rounded-md ${loadClass(
                            cell,
                            data.workdayMinutes,
                          )} ${cell.count > 0 ? "cursor-pointer hover:ring-2 hover:ring-neutral-300" : "cursor-default"}`}
                        >
                          {cell.count > 0 ? (
                            <>
                              <span className="text-xs font-semibold leading-tight">{formatMinutes(cell.minutes)}</span>
                              <span className="text-[10px] leading-tight">{cell.count} зад.</span>
                            </>
                          ) : (
                            <span className="text-xs">—</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DayDetail sel={sel} onClose={() => setSel(null)} workdayMinutes={data?.workdayMinutes ?? 0} />
    </main>
  );
}

// Панель задач конкретной ячейки (водитель × день). Тянет список через общий /api/tasks.
function DayDetail({
  sel,
  onClose,
  workdayMinutes,
}: {
  sel: { driverId: string; driverName: string; day: string } | null;
  onClose: () => void;
  workdayMinutes: number;
}) {
  const { data: tasks } = useSWR<TaskDTO[]>(
    sel ? `/api/tasks?dateFrom=${sel.day}&dateTo=${sel.day}&assigneeId=${sel.driverId}` : null,
    fetcher,
  );
  const total = (tasks ?? []).reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);

  return (
    <Modal
      open={sel !== null}
      onClose={onClose}
      title={sel ? `${sel.driverName} · ${sel.day.slice(8, 10)}.${sel.day.slice(5, 7)}` : ""}
    >
      {!tasks ? (
        <p className="text-sm text-neutral-400">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-neutral-500">Задач нет.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-600">
            Итого ≈ {formatMinutes(total)} из {formatMinutes(workdayMinutes)}
          </p>
          <ul className="flex flex-col gap-1.5">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2">
                <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm text-blue-700 hover:underline">
                  №{t.number} · {t.title}
                </Link>
                <span className="shrink-0 text-xs text-neutral-500">
                  {t.timeFrom ? `${t.timeFrom} · ` : ""}
                  {t.estimatedMinutes != null ? formatMinutes(t.estimatedMinutes) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
