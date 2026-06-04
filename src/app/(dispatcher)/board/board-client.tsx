"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { fetcher, apiSend } from "@/lib/fetcher";
import type { DriverDTO, TaskDTO, TaskTypeDTO } from "@/lib/task-dto";
import { STATUS_BADGE, STATUS_BAR, STATUS_LABEL, PASS_BADGE, PASS_LABEL, formatDate } from "@/lib/task-ui";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateTaskModal } from "../_components/create-task-modal";

type DropTarget = { kind: "driver"; driverId: string } | { kind: "unassigned" } | { kind: "undated" };

export function BoardClient({
  drivers,
  types,
  today,
}: {
  drivers: DriverDTO[];
  types: TaskTypeDTO[];
  today: string;
}) {
  const key = `/api/tasks?date=${today}&includeUndated=1`;
  const { data: tasks = [], isLoading, mutate } = useSWR<TaskDTO[]>(key, fetcher);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undated = tasks.filter((t) => !t.scheduledDate);
  const dated = tasks.filter((t) => t.scheduledDate);
  const unassignedToday = dated.filter((t) => !t.assigneeId);

  const total = dated.length;
  const inWork = dated.filter((t) => ["ACCEPTED", "EN_ROUTE", "ON_SITE"].includes(t.status)).length;
  const done = dated.filter((t) => t.status === "DONE").length;

  async function onDrop(taskId: string, target: DropTarget) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setError(null);
    try {
      if (target.kind === "undated") {
        await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "edit", scheduledDate: null });
      } else {
        if (!task.scheduledDate) {
          await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "edit", scheduledDate: today });
        }
        const assigneeId = target.kind === "driver" ? target.driverId : null;
        await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "assign", assigneeId });
      }
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quickAssign(taskId: string, assigneeId: string) {
    setError(null);
    try {
      await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "assign", assigneeId: assigneeId || null });
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-neutral-900">Сегодня · {formatDate(today)}</h1>
          <div className="flex gap-3 text-sm text-neutral-500">
            <span>Всего: <b className="text-neutral-900">{total}</b></span>
            <span>В работе: <b className="text-neutral-900">{inWork}</b></span>
            <span>Выполнено: <b className="text-neutral-900">{done}</b></span>
            <span>Не назначено: <b className="text-neutral-900">{unassignedToday.length}</b></span>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Задача
        </Button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {isLoading ? <p className="text-sm text-neutral-400">Загрузка…</p> : null}

      <div className="flex gap-3 overflow-x-auto pb-4">
        <Column
          title="Без даты"
          hint="пул для планирования"
          tasks={undated}
          drivers={drivers}
          target={{ kind: "undated" }}
          onDropTask={onDrop}
          onQuickAssign={quickAssign}
        />
        <Column
          title="Не назначено"
          tasks={unassignedToday}
          drivers={drivers}
          target={{ kind: "unassigned" }}
          onDropTask={onDrop}
          onQuickAssign={quickAssign}
        />
        {drivers.map((d) => (
          <Column
            key={d.id}
            title={d.name}
            hint={d.canLogin ? undefined : "внешний"}
            tasks={dated.filter((t) => t.assigneeId === d.id)}
            drivers={drivers}
            target={{ kind: "driver", driverId: d.id }}
            onDropTask={onDrop}
            onQuickAssign={quickAssign}
          />
        ))}
      </div>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        types={types}
        drivers={drivers}
        defaultDate={today}
        onCreated={() => void mutate()}
      />
    </div>
  );
}

function Column({
  title,
  hint,
  tasks,
  drivers,
  target,
  onDropTask,
  onQuickAssign,
}: {
  title: string;
  hint?: string;
  tasks: TaskDTO[];
  drivers: DriverDTO[];
  target: DropTarget;
  onDropTask: (taskId: string, target: DropTarget) => void;
  onQuickAssign: (taskId: string, assigneeId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-sm font-semibold text-neutral-800">{title}</span>
        <span className="text-xs text-neutral-400">
          {hint ? `${hint} · ` : ""}
          {tasks.length}
        </span>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData("text/plain");
          if (id) onDropTask(id, target);
        }}
        className={`flex min-h-32 flex-1 flex-col gap-2 rounded-xl border p-2 transition-colors ${
          over ? "border-neutral-400 bg-neutral-100" : "border-neutral-200 bg-neutral-50"
        }`}
      >
        {tasks.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-neutral-400">Пусто</p>
        ) : (
          tasks.map((t) => (
            <BoardCard key={t.id} task={t} drivers={drivers} onQuickAssign={onQuickAssign} />
          ))
        )}
      </div>
    </div>
  );
}

function BoardCard({
  task,
  drivers,
  onQuickAssign,
}: {
  task: TaskDTO;
  drivers: DriverDTO[];
  onQuickAssign: (taskId: string, assigneeId: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
      className="relative cursor-grab rounded-lg border border-neutral-200 bg-white p-2 pl-3 shadow-sm active:cursor-grabbing"
    >
      <span className={`absolute left-0 top-0 h-full w-1 rounded-l-lg ${STATUS_BAR[task.status]}`} />
      <div className="flex items-center justify-between gap-2">
        <Link href={`/tasks/${task.id}`} className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 hover:underline">
          <TypeIcon name={task.type.icon} className="h-4 w-4 text-neutral-500" />№{task.number}
          {task.priority ? <span className="text-red-500">●</span> : null}
        </Link>
        <Badge className={STATUS_BADGE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
      </div>
      <Link href={`/tasks/${task.id}`} className="mt-1 block text-sm text-neutral-800 hover:underline">
        {task.title}
      </Link>
      <p className="truncate text-xs text-neutral-500">{task.address}</p>
      {(task.timeFrom || task.timeTo || task.timeNote) ? (
        <p className="text-xs text-neutral-500">
          {task.timeFrom || task.timeTo ? `${task.timeFrom ?? ""}–${task.timeTo ?? ""} ` : ""}
          {task.timeNote ?? ""}
        </p>
      ) : null}
      {task.passStatus !== "NOT_NEEDED" ? (
        <Badge className={`mt-1 ${PASS_BADGE[task.passStatus]}`}>{PASS_LABEL[task.passStatus]}</Badge>
      ) : null}
      <select
        value={task.assigneeId ?? ""}
        onChange={(e) => onQuickAssign(task.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="mt-2 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-600 outline-none"
      >
        <option value="">— не назначено —</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
