"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { DriverDTO, TaskDTO, TaskTypeDTO } from "@/lib/task-dto";
import { actState } from "@/domain/act";
import { STATUS_LABEL, STATUS_ORDER, actBadge, formatDate, paymentBadge } from "@/lib/task-ui";
import { parseQuery } from "@/lib/task-search";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { StatusBadge } from "@/components/status-badge";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Select } from "@/components/ui/select";
import { CreateTaskModal } from "../_components/create-task-modal";
import { TaskSearchInput } from "../_components/task-search-input";
import { Highlighted } from "../_components/highlight";
import { useTaskDrafts } from "../_components/task-drafts";
import type { FormState } from "@/lib/task-draft";

export function AllTasksClient({
  drivers,
  types,
}: {
  drivers: DriverDTO[];
  types: TaskTypeDTO[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // Черновики свёрнутых заявок (доработка №1) — общий стек с доской, живёт в лейауте диспетчера.
  const drafts = useTaskDrafts();
  const [editingDraft, setEditingDraft] = useState<{ id: string; form: FormState } | null>(null);
  const registerOpenHandler = drafts.registerOpenHandler;
  useEffect(
    () =>
      registerOpenHandler((d) => {
        setEditingDraft({ id: d.id, form: d.form });
        setCreateOpen(true);
      }),
    [registerOpenHandler],
  );

  // Серверный поиск (период произвольный — данных может быть много), запрос уходит «вдогонку»
  // через 250 мс после остановки ввода; keepPreviousData сглаживает перезапросы.
  const debouncedQ = useDebouncedValue(q, 250);
  // Подсветка в таблице — по тому запросу, который реально отфильтровал сервер.
  const searchQuery = useMemo(
    () => (debouncedQ.trim() ? parseQuery(debouncedQ) : null),
    [debouncedQ],
  );

  const params = new URLSearchParams();
  if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
  if (status) params.set("status", status);
  if (assigneeId) params.set("assigneeId", assigneeId);
  if (typeId) params.set("typeId", typeId);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  const key = `/api/tasks?${params.toString()}`;
  const { data: tasks = [], isLoading, error, mutate } = useSWR<TaskDTO[]>(key, fetcher, {
    keepPreviousData: true,
  });

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Все задачи</h1>
        <Button
          onClick={() => {
            setEditingDraft(null);
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Задача
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <TaskSearchInput
          value={q}
          onChange={setQ}
          inputClassName="w-full"
          placeholder="Поиск: № / телефон / текст / счёт"
        />
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
        <DateField value={dateFrom} onChange={setDateFrom} />
        <DateField value={dateTo} onChange={setDateTo} />
      </div>

      {isLoading && tasks.length === 0 ? (
        <p className="text-sm text-neutral-400">Загрузка…</p>
      ) : null}

      {searchQuery?.active && !isLoading ? (
        <p data-testid="all-tasks-found" className="mb-2 text-xs tabular-nums text-neutral-500">
          Найдено: {tasks.length}
        </p>
      ) : null}

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
              <th className="px-3 py-2">Оплата</th>
              <th className="px-3 py-2">Акт</th>
            </tr>
          </thead>
          <tbody>
            {error && tasks.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center">
                  <p className="text-sm text-red-600">Не удалось загрузить список.</p>
                  <button
                    type="button"
                    onClick={() => void mutate()}
                    className="mt-2 text-sm text-neutral-600 underline"
                  >
                    Повторить
                  </button>
                </td>
              </tr>
            ) : tasks.length === 0 && !isLoading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-neutral-400">
                  Задач не найдено
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/tasks/${t.id}`)}
                  className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/tasks/${t.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {t.priority ? <span className="mr-1 text-red-500">●</span> : null}№
                      <Highlighted text={String(t.number)} query={searchQuery} />
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-neutral-600">
                      <TypeIcon name={t.type.icon} className="h-4 w-4" />
                      <span className="hidden sm:inline">{t.type.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/tasks/${t.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-neutral-800 hover:underline"
                    >
                      <Highlighted text={t.title} query={searchQuery} />
                    </Link>
                  </td>
                  <td className="max-w-48 truncate px-3 py-2 text-neutral-500">
                    <Highlighted text={t.address} query={searchQuery} />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{formatDate(t.scheduledDate)}</td>
                  <td className="px-3 py-2 text-neutral-600">
                    {t.assignee?.name ? (
                      <Highlighted text={t.assignee.name} query={searchQuery} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-3 py-2">
                    <PaymentCell task={t} />
                  </td>
                  <td className="px-3 py-2">
                    <ActCell task={t} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateTaskModal
        key={createOpen ? (editingDraft?.id ?? "new") : "closed"}
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setEditingDraft(null);
        }}
        types={types}
        drivers={drivers}
        onCreated={() => void mutate()}
        initialForm={editingDraft?.form ?? null}
        onMinimize={(form) => drafts.upsertDraft(form, editingDraft?.id ?? null)}
        onDiscard={() => {
          if (editingDraft?.id) drafts.removeDraft(editingDraft.id);
        }}
      />
    </div>
  );
}

// Деньги на точке (17.07): «Взять деньги · сумма» на активной ON_SITE-задаче, итог на завершённой.
function PaymentCell({ task }: { task: TaskDTO }) {
  const badge = paymentBadge(task);
  if (!badge) return <span className="text-neutral-300">—</span>;
  return <Badge className={badge.className}>{badge.label}</Badge>;
}

// Признак комплектности акта в списке (этап 14, PRD §13). hasSignedDoc приходит со списком.
function ActCell({ task }: { task: TaskDTO }) {
  const badge = actBadge(
    actState({
      requiresSignedDoc: task.requiresSignedDoc,
      actWaivedNote: task.actWaivedNote,
      hasSignedDoc: task.hasSignedDoc ?? false,
    }),
    task.status === "DONE",
  );
  if (!badge) return <span className="text-neutral-300">—</span>;
  return <Badge className={badge.className}>{badge.label}</Badge>;
}
