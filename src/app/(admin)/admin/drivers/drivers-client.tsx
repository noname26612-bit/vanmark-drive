"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { MIN_PASSWORD_LEN } from "@/domain/password-policy";

type DriverAccessView = {
  id: string;
  name: string;
  login: string;
  canLogin: boolean;
  isExternal: boolean;
  onPayroll: boolean;
  equipmentAccess: boolean; // доступ к разделам «Листогибы» и «Фальцепрокатники» (15.08.2026)
};

// «Водители — доступ» (02.07): вход вкл/выкл. С 03.08 здесь же — признак «внешний перевозчик» и
// смена пароля: раньше и то, и другое можно было изменить только сидом или запросом к базе, поэтому
// выдать доступ новому исполнителю без разработчика было нельзя.
export function DriversClient() {
  const { data: drivers = [], isLoading, mutate } = useSWR<DriverAccessView[]>("/api/admin/drivers", fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwdFor, setPwdFor] = useState<DriverAccessView | null>(null);

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

  async function toggleExternal(d: DriverAccessView) {
    const question = d.isExternal
      ? `Вернуть «${d.name}» в штат? Он снова будет вести смены и попадёт в KPI, если у него есть расчёт.`
      : `Сделать «${d.name}» внешним перевозчиком? Он не ведёт смены и не участвует в KPI и зарплате, а в заявке появится стоимость поездки.`;
    if (!confirm(question)) return;
    setError(null);
    setBusyId(d.id);
    try {
      await apiSend("/api/admin/drivers", "PATCH", { driverId: d.id, isExternal: !d.isExternal });
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось изменить признак");
    } finally {
      setBusyId(null);
    }
  }

  // Доступ к разделам оборудования (15.08.2026): единственное право, выданное не ролью. Водитель
  // остаётся водителем — меняется только видимость «Листогибов» и «Фальцепрокатников».
  async function toggleEquipment(d: DriverAccessView) {
    const question = d.equipmentAccess
      ? `Убрать у «${d.name}» доступ к Листогибам и Фальцепрокатникам?`
      : `Дать «${d.name}» полный доступ к Листогибам и Фальцепрокатникам? Задачи, смены и KPI не изменятся.`;
    if (!confirm(question)) return;
    setError(null);
    setBusyId(d.id);
    try {
      await apiSend("/api/admin/drivers", "PATCH", {
        driverId: d.id,
        equipmentAccess: !d.equipmentAccess,
      });
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось изменить доступ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Администрирование
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-neutral-900">Водители — доступ</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Кто может входить в приложение. Внешний перевозчик входит как водитель: видит свои задачи и
        ведёт статусы, но без смен, KPI и расчёта. Доступ к оборудованию открывает водителю разделы
        «Листогибы» и «Фальцепрокатники» — на задачи, смены и KPI он не влияет.
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
                  {/* Подменный водитель: смены ведёт, но расчёта у него нет — иначе он выглядит
                      как штатный и непонятно, почему его нет в зарплате (03.08). */}
                  {!d.onPayroll && !d.isExternal ? (
                    <Badge className="border border-slate-300 text-slate-600">Без расчёта</Badge>
                  ) : null}
                  {d.equipmentAccess ? (
                    <Badge className="border border-slate-300 text-slate-600">Оборудование</Badge>
                  ) : null}
                </div>
                <div className="text-sm text-neutral-500">логин: {d.login}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                <Button
                  variant="ghost"
                  data-testid="driver-password"
                  className="h-9 px-3 text-sm"
                  disabled={busyId === d.id}
                  onClick={() => setPwdFor(d)}
                >
                  Сменить пароль
                </Button>
                <Button
                  variant="ghost"
                  data-testid="driver-equipment"
                  className="h-9 px-3 text-sm"
                  disabled={busyId === d.id}
                  onClick={() => void toggleEquipment(d)}
                >
                  {d.equipmentAccess ? "Убрать оборудование" : "Дать оборудование"}
                </Button>
                <Button
                  variant="ghost"
                  data-testid="driver-external"
                  className="h-9 px-3 text-sm"
                  disabled={busyId === d.id}
                  onClick={() => void toggleExternal(d)}
                >
                  {d.isExternal ? "Вернуть в штат" : "Сделать внешним"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pwdFor ? <PasswordModal driver={pwdFor} onClose={() => setPwdFor(null)} /> : null}
    </main>
  );
}

/** Задать водителю новый пароль. Пароль показывается только здесь — передать его водителю лично. */
function PasswordModal({ driver, onClose }: { driver: DriverAccessView; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    if (value !== repeat) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/admin/drivers/password", "POST", {
        driverId: driver.id,
        newPassword: value,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Пароль — ${driver.name}`}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-700">
            Пароль изменён. Передайте его водителю лично — повторно он не показывается.
          </p>
          <Button onClick={onClose}>Закрыть</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            Логин {driver.login}. Водитель войдёт с новым паролем; уже открытое у него приложение
            продолжит работать до выхода.
          </p>
          <Field label="Новый пароль">
            <Input
              type="password"
              data-testid="driver-password-value"
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`не короче ${MIN_PASSWORD_LEN} символов`}
            />
          </Field>
          <Field label="Повторите пароль">
            <Input
              type="password"
              data-testid="driver-password-repeat"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </Field>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              data-testid="driver-password-save"
              onClick={() => void save()}
              disabled={busy || !value || !repeat}
            >
              Сохранить
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
