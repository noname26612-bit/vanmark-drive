"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, CalendarClock, CalendarOff, GripVertical, Plus } from "lucide-react";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { mergeOrder, moveTo } from "@/lib/pool-order";
import { persistUiPref } from "@/lib/ui-prefs-client";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/time-field";
import { StatusBadge } from "@/components/status-badge";
import { AuthorBadge } from "@/components/author-badge";
import { STATUS_BAR, addDaysISO, formatDateShort } from "@/lib/task-ui";
import type { TaskDTO } from "@/lib/task-dto";

// Перетаскивание колонок — своим MIME, чтобы не путаться с карточками (те кладут id в text/plain).
const POOL_MIME = "application/x-vm-staff-pool";

// Хвост просрочки: задачу, не закрытую вчера, видно у исполнителя, а не только в архиве.
const OVERDUE_DAYS = 14;
// Горизонт пула «Ближайшие»: сегодня + 7 дней. Задачи цеха планируют на неделю вперёд.
const UPCOMING_DAYS = 7;

type Performer = { id: string; name: string };

function todayISO(): string {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD в местной зоне
}

/**
 * «Сотрудники» — доска второго контура задач (цех и снабжение), решение Артёма 15.08.2026.
 *
 * Устроена как «Сегодня», но проще: у этих задач нет ни адреса, ни оплаты, ни актов — только суть,
 * исполнитель и срок. Колонка исполнителя показывает ровно то же, что он видит у себя в телефоне
 * (сегодняшние + незакрытые просроченные + назначенные без даты), иначе доска и телефон разойдутся.
 */
export function StaffBoardClient({
  performers,
  order,
  collapsed,
}: {
  performers: Performer[];
  order: string[];
  collapsed: string[];
}) {
  const router = useRouter();
  const today = todayISO();
  const [createOpen, setCreateOpen] = useState(false);
  const [poolOrder, setPoolOrder] = useState<string[]>(order);
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>(collapsed);
  const [error, setError] = useState<string | null>(null);

  const key = `/api/tasks?kind=STAFF&dateFrom=${addDaysISO(today, -OVERDUE_DAYS)}&dateTo=${addDaysISO(
    today,
    UPCOMING_DAYS,
  )}&includeUndated=1&hideCancelled=1`;
  const { data: tasks = [], mutate } = useSWR<TaskDTO[]>(key, fetcher, { refreshInterval: 10_000 });

  const poolKeys = useMemo(
    () => ["undated", "upcoming", ...performers.map((p) => `staff:${p.id}`)],
    [performers],
  );
  const displayOrder = useMemo(() => mergeOrder(poolOrder, poolKeys), [poolOrder, poolKeys]);

  function reorder(dragKey: string, targetKey: string) {
    const next = moveTo(displayOrder, dragKey, targetKey);
    setPoolOrder(next);
    void persistUiPref("staff.order", next);
  }

  function toggleCollapse(poolKey: string) {
    const next = collapsedKeys.includes(poolKey)
      ? collapsedKeys.filter((k) => k !== poolKey)
      : [...collapsedKeys, poolKey];
    setCollapsedKeys(next);
    void persistUiPref("staff.collapsed", next);
  }

  // Дата приходит полным ISO («2026-08-15T00:00:00.000Z») — сравниваем по дню, как на доске.
  const dayOf = (t: TaskDTO): string | null => (t.scheduledDate ? t.scheduledDate.slice(0, 10) : null);
  // Незакрытая задача остаётся у исполнителя, пока он её не закроет: просроченная не должна
  // выпадать из поля зрения только потому, что наступил следующий день.
  const isOpen = (t: TaskDTO) => t.status !== "DONE" && t.status !== "CANCELLED";
  const forToday = (t: TaskDTO) => {
    const day = dayOf(t);
    return day === today || (isOpen(t) && (day === null || day < today));
  };

  async function assign(taskId: string, assigneeId: string | null) {
    setError(null);
    try {
      await apiSend(`/api/tasks/${taskId}`, "PATCH", {
        op: "plan",
        assigneeId,
        scheduledDate: assigneeId ? today : null,
      });
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось назначить");
    }
  }

  const pools = displayOrder.map((poolKey) => {
    if (poolKey === "undated") {
      return {
        poolKey,
        title: "Без даты",
        icon: <CalendarOff className="h-4 w-4" />,
        tasks: tasks.filter((t) => dayOf(t) === null && !t.assignee),
        target: null as string | null,
      };
    }
    if (poolKey === "upcoming") {
      return {
        poolKey,
        title: "Ближайшие",
        icon: <CalendarClock className="h-4 w-4" />,
        tasks: tasks.filter((t) => {
          const day = dayOf(t);
          return day !== null && day > today;
        }),
        target: null,
      };
    }
    const id = poolKey.slice("staff:".length);
    const person = performers.find((p) => p.id === id);
    return {
      poolKey,
      title: person?.name ?? "—",
      icon: null,
      tasks: tasks.filter((t) => t.assignee?.id === id && forToday(t)),
      target: id,
    };
  });

  const openCount = tasks.filter((t) => forToday(t) && isOpen(t)).length;
  const inWork = tasks.filter((t) => t.status === "IN_PROGRESS").length;

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Задачи сотрудникам</h1>
          <p className="text-sm text-neutral-500">
            Цех и снабжение. Доставки — на вкладке «Сегодня».
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="staff-create">
          <Plus className="h-4 w-4" /> Задача
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Stat label="В работе сегодня" value={openCount} />
        <Stat label="Выполняются" value={inWork} accent={inWork > 0} />
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {performers.length === 0 ? (
        <p className="rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Никому не открыт доступ к задачам сотрудникам. Выдайте его в «Управление» → «Водители —
          доступ».
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="staff-columns">
          {pools.map((pool) => (
            <StaffColumn
              key={pool.poolKey}
              poolKey={pool.poolKey}
              title={pool.title}
              icon={pool.icon}
              tasks={pool.tasks}
              performerId={pool.target}
              collapsed={collapsedKeys.includes(pool.poolKey)}
              onToggleCollapse={() => toggleCollapse(pool.poolKey)}
              onReorder={reorder}
              onDropTask={(taskId) => void assign(taskId, pool.target)}
              onOpen={(taskId) => router.push(`/tasks/${taskId}`)}
            />
          ))}
        </div>
      )}

      {createOpen ? (
        <CreateStaffTaskModal
          performers={performers}
          today={today}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void mutate()}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className={cn("text-lg font-semibold", accent ? "text-blue-700" : "text-neutral-900")}>
        {value}
      </div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function StaffColumn({
  poolKey,
  title,
  icon,
  tasks,
  performerId,
  collapsed,
  onToggleCollapse,
  onReorder,
  onDropTask,
  onOpen,
}: {
  poolKey: string;
  title: string;
  icon: React.ReactNode;
  tasks: TaskDTO[];
  performerId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onReorder: (dragKey: string, targetKey: string) => void;
  onDropTask: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const droppable = performerId !== null;

  // Шапка тащится сама (перестановка колонок) и принимает только такие же шапки — по своему MIME.
  const headProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(POOL_MIME, poolKey);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(POOL_MIME)) return;
      e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(POOL_MIME)) return;
      e.preventDefault();
      const dragKey = e.dataTransfer.getData(POOL_MIME);
      if (dragKey) onReorder(dragKey, poolKey);
    },
  };

  const bodyProps =
    droppable && !collapsed
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (e.dataTransfer.types.includes(POOL_MIME)) return;
            e.preventDefault();
            setOver(true);
          },
          onDragLeave: () => setOver(false),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setOver(false);
            const id = e.dataTransfer.getData("text/plain");
            if (id) onDropTask(id);
          },
        }
      : {};

  if (collapsed) {
    return (
      <div className="w-12 shrink-0" data-testid={`staff-col-${poolKey}`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-full w-full flex-col items-center gap-2 rounded-lg bg-slate-900 py-3 text-white"
          data-testid={`staff-expand-${poolKey}`}
          {...headProps}
        >
          <GripVertical className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold">{tasks.length}</span>
          <span className="[writing-mode:vertical-rl] text-xs">{title}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 shrink-0" data-testid={`staff-col-${poolKey}`}>
      <div
        className="flex items-center justify-between gap-2 rounded-t-lg bg-slate-900 px-3 py-2 text-white"
        {...headProps}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />
          {icon}
          <span className="truncate text-sm font-medium">{title}</span>
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="shrink-0 rounded px-1.5 text-xs text-slate-300 hover:text-white"
          data-testid={`staff-collapse-${poolKey}`}
        >
          {tasks.length} ↕
        </button>
      </div>
      <div
        className={cn(
          "min-h-24 rounded-b-lg border border-t-0 border-neutral-200 bg-white p-2",
          over && "ring-2 ring-slate-400",
        )}
        {...bodyProps}
      >
        {tasks.length === 0 ? (
          <p className="px-1 py-3 text-xs text-neutral-400">Пусто</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tasks.map((t) => (
              <li key={t.id}>
                <StaffCard task={t} onOpen={() => onOpen(t.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StaffCard({ task, onOpen }: { task: TaskDTO; onOpen: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      className="flex cursor-pointer items-stretch gap-2 overflow-hidden rounded border border-neutral-200 bg-white hover:bg-neutral-50"
      data-testid={`staff-card-${task.number}`}
    >
      <span className={cn("w-1 shrink-0", STATUS_BAR[task.status])} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2 pr-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">№{task.number}</span>
          {task.priority ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Срочно" />
          ) : null}
          <StatusBadge status={task.status} />
          <AuthorBadge name={task.createdBy?.name} />
        </div>
        <span className="truncate text-sm text-neutral-900">{task.title}</span>
        <span className="flex flex-wrap gap-x-2 text-xs text-neutral-500">
          {task.scheduledDate ? <span>{formatDateShort(task.scheduledDate)}</span> : null}
          {task.timeFrom ? (
            <span>
              {task.timeFrom}
              {task.timeTo ? `–${task.timeTo}` : ""}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/**
 * Постановка задачи сотруднику. Полей ровно столько, сколько нужно: что сделать, кому и когда —
 * классификации у этих задач нет (решение Артёма 15.08.2026, «пока не усложняем»).
 */
function CreateStaffTaskModal({
  performers,
  today,
  onClose,
  onCreated,
}: {
  performers: Performer[];
  today: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(today);
  const [timeFrom, setTimeFrom] = useState("");
  const [priority, setPriority] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(keepOpen: boolean) {
    if (!title.trim()) {
      setError("Напишите, что нужно сделать");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiSend("/api/tasks", "POST", {
        kind: "STAFF",
        title: title.trim(),
        description: description.trim() || null,
        assigneeId: assigneeId || null,
        scheduledDate: scheduledDate || null,
        timeFrom: timeFrom || null,
        priority,
      });
      onCreated();
      if (keepOpen) {
        setTitle("");
        setDescription("");
        setTimeFrom("");
        setPriority(false);
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось создать задачу");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Задача сотруднику">
      <div className="flex flex-col gap-3">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <Field label="Что сделать" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: забрать ролики с Ленинградки"
            autoFocus
            data-testid="staff-title"
          />
        </Field>

        <Field label="Подробности">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            data-testid="staff-description"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Кому">
            <Select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              data-testid="staff-assignee"
            >
              <option value="">— не назначено —</option>
              {performers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Когда">
            <DateField value={scheduledDate} onChange={setScheduledDate} testId="staff-date" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ко скольки">
            <TimeField value={timeFrom} onChange={setTimeFrom} testId="staff-time" />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={priority}
              onChange={(e) => setPriority(e.target.checked)}
              className="h-4 w-4"
              data-testid="staff-priority"
            />
            Срочно
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button variant="secondary" onClick={() => void submit(true)} disabled={saving}>
            Создать и ещё
          </Button>
          <Button onClick={() => void submit(false)} disabled={saving} data-testid="staff-save">
            Создать
          </Button>
        </div>
      </div>
    </Modal>
  );
}
