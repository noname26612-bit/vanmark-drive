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
import { roleLabel, type Role } from "@/domain/roles";

type UserAccessView = {
  id: string;
  name: string;
  login: string;
  role: Role;
  position: string | null;
  canLogin: boolean;
  isExternal: boolean;
  onPayroll: boolean;
  equipmentAccess: boolean; // доступ к разделам «Листогибы» и «Фальцепрокатники» (15.08.2026)
  staffTasksAccess: boolean; // задачи сотрудникам: цех и снабжение (15.08.2026)
};

/**
 * «Пользователи и доступ» (02.07 — водители, 22.08.2026 — учётки офиса).
 *
 * Две группы, потому что права у них разные по существу: офису (диспетчер, менеджер-сервисник,
 * директор, админ) меняют пароль и вход, водителю — ещё и три персональных признака (внешний
 * перевозчик, оборудование, задачи сотрудникам), которых у офиса не существует.
 *
 * Сотрудников цеха без входа (роль EMPLOYEE) здесь нет: их заводят в «Команде», доступа у них нет
 * by design (PRD §18), и сервер на такие id отвечает 404.
 */
export function DriversClient({ currentUserId }: { currentUserId: string }) {
  const { data: users = [], isLoading, mutate } = useSWR<UserAccessView[]>("/api/admin/drivers", fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwdFor, setPwdFor] = useState<UserAccessView | null>(null);

  async function patch(userId: string, body: Record<string, unknown>, fallback: string) {
    setError(null);
    setBusyId(userId);
    try {
      await apiSend("/api/admin/drivers", "PATCH", { userId, ...body });
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleLogin(u: UserAccessView) {
    const verb = u.canLogin ? "Запретить вход" : "Разрешить вход";
    if (!confirm(`${verb} для «${u.name}» (логин ${u.login})?`)) return;
    await patch(u.id, { canLogin: !u.canLogin }, "Не удалось изменить доступ");
  }

  async function toggleExternal(u: UserAccessView) {
    const question = u.isExternal
      ? `Вернуть «${u.name}» в штат? Он снова будет вести смены и попадёт в KPI, если у него есть расчёт.`
      : `Сделать «${u.name}» внешним перевозчиком? Он не ведёт смены и не участвует в KPI и зарплате, а в заявке появится стоимость поездки.`;
    if (!confirm(question)) return;
    await patch(u.id, { isExternal: !u.isExternal }, "Не удалось изменить признак");
  }

  // Доступ к задачам сотрудникам (15.08.2026, вечер): цех и снабжение — вторая половина работы
  // Александра и Николая. Роль остаётся DRIVER: доставки они возят по-прежнему.
  async function toggleStaffTasks(u: UserAccessView) {
    const question = u.staffTasksAccess
      ? `Убрать у «${u.name}» задачи сотрудникам? Уже поставленные останутся у него в телефоне.`
      : `Разрешить ставить «${u.name}» задачи сотрудникам (цех, снабжение)? Доставки и смены не изменятся.`;
    if (!confirm(question)) return;
    await patch(u.id, { staffTasksAccess: !u.staffTasksAccess }, "Не удалось изменить доступ");
  }

  // Доступ к разделам оборудования (15.08.2026): единственное право, выданное не ролью. Водитель
  // остаётся водителем — меняется только видимость «Листогибов» и «Фальцепрокатников».
  async function toggleEquipment(u: UserAccessView) {
    const question = u.equipmentAccess
      ? `Убрать у «${u.name}» доступ к Листогибам и Фальцепрокатникам?`
      : `Дать «${u.name}» полный доступ к Листогибам и Фальцепрокатникам? Задачи, смены и KPI не изменятся.`;
    if (!confirm(question)) return;
    await patch(u.id, { equipmentAccess: !u.equipmentAccess }, "Не удалось изменить доступ");
  }

  const office = users.filter((u) => u.role !== "DRIVER");
  const drivers = users.filter((u) => u.role === "DRIVER");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Управление
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-neutral-900">Пользователи и доступ</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Кто может входить в приложение и с каким паролем. Офису доступны пароль и вход; водителю —
        ещё и признаки «внешний перевозчик», доступ к оборудованию и к задачам сотрудникам. Сотрудники
        цеха без входа заводятся во вкладке «Команда» — здесь их нет.
      </p>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {isLoading && users.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">Загрузка…</p>
      ) : (
        <>
          <Group title="Офис" testId="access-office">
            {office.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                busy={busyId === u.id}
                isSelf={u.id === currentUserId}
                onToggleLogin={() => void toggleLogin(u)}
                onPassword={() => setPwdFor(u)}
              />
            ))}
            {office.length === 0 ? <Empty /> : null}
          </Group>

          <Group title="Водители" testId="access-drivers">
            {drivers.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                busy={busyId === u.id}
                isSelf={u.id === currentUserId}
                onToggleLogin={() => void toggleLogin(u)}
                onPassword={() => setPwdFor(u)}
                onToggleEquipment={() => void toggleEquipment(u)}
                onToggleStaffTasks={() => void toggleStaffTasks(u)}
                onToggleExternal={() => void toggleExternal(u)}
              />
            ))}
            {drivers.length === 0 ? <Empty /> : null}
          </Group>
        </>
      )}
      {pwdFor ? <PasswordModal user={pwdFor} onClose={() => setPwdFor(null)} /> : null}
    </main>
  );
}

function Group({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5" data-testid={testId}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {children}
      </ul>
    </section>
  );
}

function Empty() {
  return <li className="px-4 py-3 text-sm text-neutral-400">Пусто.</li>;
}

function UserRow({
  user: u,
  busy,
  isSelf,
  onToggleLogin,
  onPassword,
  onToggleEquipment,
  onToggleStaffTasks,
  onToggleExternal,
}: {
  user: UserAccessView;
  busy: boolean;
  isSelf: boolean;
  onToggleLogin: () => void;
  onPassword: () => void;
  onToggleEquipment?: () => void;
  onToggleStaffTasks?: () => void;
  onToggleExternal?: () => void;
}) {
  const driver = u.role === "DRIVER";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-neutral-900">{u.name}</span>
          {/* Роль и должность — бейджами: у Михаила роль ADMIN, а называют его директором.
              Должность, повторяющую роль слово в слово (у Максима так), вторым бейджем не рисуем. */}
          <Badge className="border border-slate-300 text-slate-600">{roleLabel(u.role)}</Badge>
          {u.position && u.position !== roleLabel(u.role) ? (
            <Badge className="border border-slate-300 text-slate-600">{u.position}</Badge>
          ) : null}
          {isSelf ? <Badge className="border border-slate-300 text-slate-500">это вы</Badge> : null}
          {u.isExternal ? <Badge className="border border-slate-300 text-slate-600">Внешний</Badge> : null}
          {driver && u.onPayroll ? (
            <Badge className="border border-slate-300 text-slate-600">На окладе</Badge>
          ) : null}
          {/* Подменный водитель: смены ведёт, но расчёта у него нет — иначе он выглядит
              как штатный и непонятно, почему его нет в зарплате (03.08). */}
          {driver && !u.onPayroll && !u.isExternal ? (
            <Badge className="border border-slate-300 text-slate-600">Без расчёта</Badge>
          ) : null}
          {u.equipmentAccess ? (
            <Badge className="border border-slate-300 text-slate-600">Оборудование</Badge>
          ) : null}
          {u.staffTasksAccess ? (
            <Badge className="border border-slate-300 text-slate-600">Задачи сотрудникам</Badge>
          ) : null}
        </div>
        <div className="text-sm text-neutral-500">логин: {u.login}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-medium ${u.canLogin ? "text-green-700" : "text-neutral-500"}`}>
          {u.canLogin ? "Вход разрешён" : "Входа нет"}
        </span>
        {/* Себе вход не закрывают — кнопку не показываем вовсе (сервер это тоже не примет). */}
        {isSelf ? (
          <span className="text-xs text-neutral-400">свой вход не меняют</span>
        ) : (
          <Button
            variant="secondary"
            data-testid="user-login-toggle"
            className="h-9 px-3 text-sm"
            disabled={busy}
            onClick={onToggleLogin}
          >
            {u.canLogin ? "Запретить" : "Разрешить"}
          </Button>
        )}
        <Button
          variant="ghost"
          data-testid="driver-password"
          className="h-9 px-3 text-sm"
          disabled={busy}
          onClick={onPassword}
        >
          Сменить пароль
        </Button>
        {onToggleEquipment ? (
          <Button
            variant="ghost"
            data-testid="driver-equipment"
            className="h-9 px-3 text-sm"
            disabled={busy}
            onClick={onToggleEquipment}
          >
            {u.equipmentAccess ? "Убрать оборудование" : "Дать оборудование"}
          </Button>
        ) : null}
        {onToggleStaffTasks ? (
          <Button
            variant="ghost"
            data-testid="driver-staff-tasks"
            className="h-9 px-3 text-sm"
            disabled={busy}
            onClick={onToggleStaffTasks}
          >
            {u.staffTasksAccess ? "Убрать задачи сотрудникам" : "Дать задачи сотрудникам"}
          </Button>
        ) : null}
        {onToggleExternal ? (
          <Button
            variant="ghost"
            data-testid="driver-external"
            className="h-9 px-3 text-sm"
            disabled={busy}
            onClick={onToggleExternal}
          >
            {u.isExternal ? "Вернуть в штат" : "Сделать внешним"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Задать пользователю новый пароль. Пароль показывается только здесь — передать его лично. */
function PasswordModal({ user, onClose }: { user: UserAccessView; onClose: () => void }) {
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
      await apiSend("/api/admin/drivers/password", "POST", { userId: user.id, newPassword: value });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Пароль — ${user.name}`}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-700">
            Пароль изменён. Передайте его лично — повторно он не показывается.
          </p>
          <Button onClick={onClose}>Закрыть</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            Логин {user.login}. Вход с новым паролем; уже открытое приложение продолжит работать до
            выхода.
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
