"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Phone, Navigation } from "lucide-react";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { cachedFetcher } from "@/lib/offline/cached-fetcher";
import { useOnline } from "@/lib/offline/net";
import { usePendingActions } from "@/lib/offline/use-queue";
import { overlayStatus } from "@/lib/offline/overlay";
import type { TaskDTO } from "@/lib/task-dto";
import type { TaskStatus } from "@/generated/prisma/enums";
import {
  STATUS_BAR,
  PASS_BADGE,
  PASS_LABEL,
  formatDate,
  formatDateShort,
  todayISO,
  navUrl,
} from "@/lib/task-ui";
import { StatusBadge } from "@/components/status-badge";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";

type Tab = "today" | "upcoming";

function isTerminal(s: TaskStatus): boolean {
  return s === "DONE" || s === "CANCELLED";
}

export function DriverTasksClient({ showPayroll = true }: { showPayroll?: boolean }) {
  const today = todayISO();
  const [tab, setTab] = useState<Tab>("today");
  const key = `/api/my/tasks?date=${today}&scope=${tab}`;
  const online = useOnline();
  const pending = usePendingActions();
  const { data: tasks = [], isLoading, error } = useSWR<TaskDTO[]>(key, cachedFetcher, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  // Статус с учётом неотправленных переходов (офлайн-очередь): задача, завершённая без сети,
  // сразу уходит в «завершено», и в карточке виден актуальный статус, а не серверный/кэшированный.
  const display = (t: TaskDTO): TaskStatus =>
    overlayStatus(t.status, pending.filter((a) => a.taskId === t.id));
  const pendingCountFor = (t: TaskDTO): number =>
    pending.filter((a) => a.taskId === t.id && (a.status === "pending" || a.status === "syncing")).length;
  // Активная задача («В работе») — наверх списка (№6). Сортировка устойчивая: внутри групп сохраняется
  // серверный порядок (priority→дата→время→номер). Активность считаем по ОТОБРАЖАЕМОМУ статусу, чтобы
  // задача, взятая в работу офлайн (ещё не досланная), тоже поднималась наверх.
  const active = tasks
    .filter((t) => !isTerminal(display(t)))
    .sort((a, b) => (display(a) === "IN_PROGRESS" ? 0 : 1) - (display(b) === "IN_PROGRESS" ? 0 : 1));
  const done = tasks.filter((t) => isTerminal(display(t))); // в «Сегодня» это завершённые за день
  // Ошибка фонового поллинга, но задачи уже загружены — не сносим список (плохая сеть на объекте).
  const staleError = error && tasks.length > 0;

  return (
    <main className="px-3 pb-10 pt-3">
      {/* Ссылка на личный расчёт зарплаты (Фаза 1.5) — только у водителей с денежным профилем. */}
      {showPayroll ? (
        <div className="mb-3 flex justify-end">
          <Link href="/m/payroll" className="text-sm font-medium text-neutral-600 underline">
            Мой расчёт →
          </Link>
        </div>
      ) : null}

      {/* Смена водителя (этап C): открыть утром (фактическое начало дня) → диспетчер подтвердит → закрыть. */}
      <ShiftBlock today={today} />

      {/* Вкладки — крупные тач-цели */}
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
        <TabButton active={tab === "today"} onClick={() => setTab("today")}>
          Сегодня
        </TabButton>
        <TabButton active={tab === "upcoming"} onClick={() => setTab("upcoming")}>
          Ближайшие
        </TabButton>
      </div>

      <p className="mb-3 px-1 text-sm text-neutral-500">
        {tab === "today"
          ? `${formatDate(today)} · задач: ${active.length}`
          : `Завтра и позже · задач: ${tasks.length}`}
      </p>

      {!online || staleError ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {online
            ? "Нет связи — показываю последнее. Обновлю автоматически."
            : "Офлайн — показываю сохранённое. Действия сохранятся и уйдут при связи."}
        </p>
      ) : null}

      {error && tasks.length === 0 ? (
        <p className="rounded-lg bg-red-50 px-3 py-4 text-base text-red-700">
          Не удалось загрузить список. Проверяю связь…
        </p>
      ) : isLoading && tasks.length === 0 ? (
        <p className="px-1 py-10 text-center text-base text-neutral-400">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((t) => (
            <li key={t.id}>
              <TaskCard task={t} displayStatus={display(t)} pending={pendingCountFor(t)} today={today} />
            </li>
          ))}
          {done.length > 0 ? (
            <>
              <li className="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Завершено сегодня
              </li>
              {done.map((t) => (
                <li key={t.id}>
                  <TaskCard task={t} displayStatus={display(t)} pending={pendingCountFor(t)} today={today} dimmed />
                </li>
              ))}
            </>
          ) : null}
        </ul>
      )}
    </main>
  );
}

type ShiftDTO = {
  id: string;
  status: "REQUESTED" | "OPEN" | "CLOSED";
  openedAt: string;
  confirmedAt: string | null;
  closedAt: string | null;
};

// «чч:мм» из ISO в местной зоне (для времени открытия/закрытия смены).
function hhmm(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Блок смены вверху «Мои задачи»: открыть смену (фактическое начало дня), статус ожидания
// подтверждения диспетчером, закрыть смену. Цвета — по ui-guidelines: янтарь = ждёт подтверждения,
// зелёный = смена идёт, графит = закрыта/нет.
function ShiftBlock({ today }: { today: string }) {
  const { data: shift, isLoading, mutate } = useSWR<ShiftDTO | null>(
    `/api/my/shift?date=${today}`,
    fetcher,
    { refreshInterval: 10_000 },
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(op: "open" | "close" | "reopen") {
    setBusy(true);
    setErr(null);
    try {
      await apiSend("/api/my/shift", "POST", { op, today });
      await mutate();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Не удалось");
    } finally {
      setBusy(false);
    }
  }

  if (shift === undefined && isLoading) {
    return <div className="mb-3 h-12 rounded-xl border border-neutral-200 bg-white" aria-hidden />;
  }

  if (!shift) {
    return (
      <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-3">
        <p className="text-sm text-neutral-500">Смена не открыта</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("open")}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-lg bg-indigo-600 text-base font-semibold text-white transition-colors active:bg-indigo-700 disabled:opacity-60"
        >
          Открыть смену
        </button>
        {err ? <p className="mt-1 text-sm text-red-600">{err}</p> : null}
      </div>
    );
  }

  if (shift.status === "CLOSED") {
    return (
      <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-3">
        <p className="text-sm text-neutral-500">
          Смена закрыта · {hhmm(shift.openedAt)}–{hhmm(shift.closedAt)}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("reopen")}
          className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg border border-indigo-300 bg-white text-base font-medium text-indigo-700 active:bg-indigo-50 disabled:opacity-60"
        >
          Возобновить смену
        </button>
        {err ? <p className="mt-1 text-sm text-red-600">{err}</p> : null}
      </div>
    );
  }

  const requested = shift.status === "REQUESTED";
  return (
    <div
      className={`mb-3 rounded-xl border p-3 ${
        requested ? "border-amber-300 bg-amber-50" : "border-green-300 bg-green-50"
      }`}
    >
      <p className={`text-sm font-medium ${requested ? "text-amber-800" : "text-green-800"}`}>
        {requested
          ? `Открыта в ${hhmm(shift.openedAt)} · ждёт подтверждения диспетчера`
          : `Смена идёт с ${hhmm(shift.openedAt)}`}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Закрыть смену? Если закроете случайно — потом можно возобновить.")) {
            void act("close");
          }
        }}
        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg border border-neutral-300 bg-white text-base font-medium text-neutral-800 disabled:opacity-60"
      >
        Закрыть смену
      </button>
      {err ? <p className="mt-1 text-sm text-red-600">{err}</p> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-12 rounded-lg text-base font-medium transition-colors ${
        active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="px-3 py-16 text-center">
      <p className="text-lg text-neutral-500">
        {tab === "today" ? "На сегодня задач нет 🎉" : "Ближайших задач нет"}
      </p>
    </div>
  );
}

function TaskCard({
  task,
  displayStatus,
  pending,
  today,
  dimmed,
}: {
  task: TaskDTO;
  displayStatus: TaskStatus;
  pending: number;
  today: string;
  dimmed?: boolean;
}) {
  const dateISO = task.scheduledDate?.slice(0, 10) ?? null;
  const overdue = dateISO !== null && dateISO < today && !isTerminal(displayStatus);
  const undated = dateISO === null && !isTerminal(displayStatus);
  const timeline =
    task.timeFrom || task.timeTo
      ? `${task.timeFrom ?? ""}${task.timeTo ? "–" + task.timeTo : ""}`
      : (task.timeNote ?? "");

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm ${
        dimmed ? "opacity-60" : ""
      }`}
    >
      <span
        className={`absolute left-0 top-0 h-full w-1.5 ${STATUS_BAR[displayStatus]}`}
        aria-hidden
      />
      <Link href={`/m/${task.id}`} className="block py-3 pl-4 pr-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-base font-semibold text-neutral-700">
            <TypeIcon name={task.type.icon} className="h-6 w-6" />
            №{task.number}
            {task.priority ? (
              <span className="text-red-500" aria-hidden>
                ●
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-1.5">
            {/* Неяркая (графитовая) метка активной задачи — она же поднята наверх списка (№6).
                По отображаемому статусу: учитывает взятие в работу офлайн. */}
            {displayStatus === "IN_PROGRESS" ? (
              <Badge className="border border-slate-300 text-slate-600">Активна</Badge>
            ) : null}
            {pending > 0 ? <Badge className="bg-amber-100 text-amber-700">⏳ ждёт</Badge> : null}
            <StatusBadge status={displayStatus} />
          </span>
        </div>

        {timeline || overdue || undated ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {timeline ? <span className="font-medium text-neutral-700">{timeline}</span> : null}
            {overdue ? (
              <Badge className="bg-red-100 text-red-700">
                Просрочено · {formatDateShort(task.scheduledDate)}
              </Badge>
            ) : null}
            {undated ? <Badge className="bg-neutral-100 text-neutral-500">Без даты</Badge> : null}
          </div>
        ) : null}

        <p className="mt-1 text-base font-semibold leading-snug text-neutral-900">{task.title}</p>
        <p className="mt-0.5 text-sm leading-snug text-neutral-500">{task.address}</p>

        {task.passStatus !== "NOT_NEEDED" ? (
          <Badge className={`mt-2 ${PASS_BADGE[task.passStatus]}`}>{PASS_LABEL[task.passStatus]}</Badge>
        ) : null}
      </Link>

      {/* Быстрые действия — вне Link, чтобы тап не открывал карточку */}
      <div className="flex gap-2 border-t border-neutral-100 px-3 py-2">
        <a
          href={navUrl(task.addressLink, task.address)}
          target="_blank"
          rel="noopener"
          className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-50 text-sm font-medium text-blue-700"
        >
          <Navigation className="h-4 w-4" /> Навигатор
        </a>
        {task.contactPhone ? (
          <a
            href={`tel:${task.contactPhone}`}
            className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-50 text-sm font-medium text-green-700"
          >
            <Phone className="h-4 w-4" /> Позвонить
          </a>
        ) : null}
      </div>
    </div>
  );
}
