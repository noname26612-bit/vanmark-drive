"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type DriverAccessView = {
  id: string;
  name: string;
  login: string;
  canLogin: boolean;
  isExternal: boolean;
  onPayroll: boolean;
};

// «Водители — доступ» (02.07): вход вкл/выкл. Пароль не меняется — остаётся прежний (из сида);
// смена пароля — отдельная задача, если понадобится.
export function DriversClient() {
  const { data: drivers = [], isLoading, mutate } = useSWR<DriverAccessView[]>("/api/admin/drivers", fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(d: DriverAccessView) {
    const verb = d.canLogin ? "Запретить вход" : "Разрешить вход";
    if (!confirm(`${verb} для «${d.name}» (логин ${d.login})?`)) return;
    setError(null);
    setBusyId(d.id);
    try {
      await apiSend("/api/admin/drivers", "PATCH", { driverId: d.id, canLogin: !d.canLogin });
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось изменить доступ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Водители — доступ</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Кто может входить в приложение. Внешний перевозчик входит как водитель: видит свои задачи и
        ведёт статусы, но без смен, KPI и расчёта. Пароль при включении не меняется.
      </p>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {isLoading && drivers.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">Загрузка…</p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {drivers.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">{d.name}</span>
                  {d.isExternal ? (
                    <Badge className="border border-slate-300 text-slate-600">Внешний</Badge>
                  ) : null}
                  {d.onPayroll ? (
                    <Badge className="border border-slate-300 text-slate-600">На окладе</Badge>
                  ) : null}
                </div>
                <div className="text-sm text-neutral-500">логин: {d.login}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${d.canLogin ? "text-green-700" : "text-neutral-500"}`}>
                  {d.canLogin ? "Вход разрешён" : "Входа нет"}
                </span>
                <Button
                  variant="secondary"
                  className="h-9 px-3 text-sm"
                  disabled={busyId === d.id}
                  onClick={() => void toggle(d)}
                >
                  {d.canLogin ? "Запретить" : "Разрешить"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
