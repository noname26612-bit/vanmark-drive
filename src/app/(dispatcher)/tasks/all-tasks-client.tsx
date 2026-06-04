"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { DriverDTO, TaskDTO, TaskTypeDTO } from "@/lib/task-dto";
import { STATUS_BADGE, STATUS_LABEL, STATUS_ORDER, formatDate } from "@/lib/task-ui";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CreateTaskModal } from "../_components/create-task-modal";

export function AllTasksClient({
  drivers,
  types,
}: {
  drivers: DriverDTO[];
  types: TaskTypeDTO[];
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  if (assigneeId) params.set("assigneeId", assigneeId);
  if (typeId) params.set("typeId", typeId);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  const key = `/api/tasks?${params.toString()}`;
  const { data: tasks = [], isLoading, mutate } = useSWR<TaskDTO[]>(key, fetcher);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Все задачи</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Задача
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input placeholder="Поиск: № / текст / счёт" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Любой статус</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Любой исполнитель</option>
          <option value="none">Не назначено</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Любой тип</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      {isLoading ? <p className="text-sm text-neutral-400">Загрузка…</p> : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs text-neutral-400">
            <tr>
              <th className="px-3 py-2">№</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Адрес</th>
              <th className="px-3 py-2">Дата</th>
              <th className="px-3 py-2">Исполнитель</th>
              <th className="px-3 py-2">Статус</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && !isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-neutral-400">
                  Задач не найдено
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr key={t.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/tasks/${t.id}`} className="hover:underline">
                      {t.priority ? <span className="mr-1 text-red-500">●</span> : null}№{t.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-neutral-600">
                      <TypeIcon name={t.type.icon} className="h-4 w-4" />
                      <span className="hidden sm:inline">{t.type.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/tasks/${t.id}`} className="text-neutral-800 hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="max-w-48 truncate px-3 py-2 text-neutral-500">{t.address}</td>
                  <td className="px-3 py-2 text-neutral-500">{formatDate(t.scheduledDate)}</td>
                  <td className="px-3 py-2 text-neutral-600">{t.assignee?.name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge className={STATUS_BADGE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        types={types}
        drivers={drivers}
        onCreated={() => void mutate()}
      />
    </div>
  );
}
