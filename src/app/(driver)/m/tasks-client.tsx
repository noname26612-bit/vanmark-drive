"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Phone, Navigation } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { TaskDTO } from "@/lib/task-dto";
import type { TaskStatus } from "@/generated/prisma/enums";
import {
  STATUS_BADGE,
  STATUS_BAR,
  STATUS_LABEL,
  PASS_BADGE,
  PASS_LABEL,
  formatDate,
  formatDateShort,
  todayISO,
  navUrl,
} from "@/lib/task-ui";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";

type Tab = "today" | "upcoming";

function isTerminal(s: TaskStatus): boolean {
  return s === "DONE" || s === "CANCELLED";
}

export function DriverTasksClient() {
  const today = todayISO();
  const [tab, setTab] = useState<Tab>("today");
  const key = `/api/my/tasks?date=${today}&scope=${tab}`;
  const { data: tasks = [], isLoading, error } = useSWR<TaskDTO[]>(key, fetcher, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const active = tasks.filter((t) => !isTerminal(t.status));
  const done = tasks.filter((t) => isTerminal(t.status)); // в «Сегодня» это завершённые за день

  return (
    <main className="px-3 pb-10 pt-3">
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

      {error ? (
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
              <TaskCard task={t} today={today} />
            </li>
          ))}
          {done.length > 0 ? (
            <>
              <li className="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Завершено сегодня
              </li>
              {done.map((t) => (
                <li key={t.id}>
                  <TaskCard task={t} today={today} dimmed />
                </li>
              ))}
            </>
          ) : null}
        </ul>
      )}
    </main>
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
  today,
  dimmed,
}: {
  task: TaskDTO;
  today: string;
  dimmed?: boolean;
}) {
  const dateISO = task.scheduledDate?.slice(0, 10) ?? null;
  const overdue = dateISO !== null && dateISO < today && !isTerminal(task.status);
  const undated = dateISO === null && !isTerminal(task.status);
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
        className={`absolute left-0 top-0 h-full w-1.5 ${STATUS_BAR[task.status]}`}
        aria-hidden
      />
      <Link href={`/m/${task.id}`} className="block py-3 pl-4 pr-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-500">
            <TypeIcon name={task.type.icon} className="h-4 w-4" />
            №{task.number}
            {task.priority ? (
              <span className="text-red-500" aria-hidden>
                ●
              </span>
            ) : null}
          </span>
          <Badge className={STATUS_BADGE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
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
