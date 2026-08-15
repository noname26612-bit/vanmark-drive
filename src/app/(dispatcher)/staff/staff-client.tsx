"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  AlertTriangle,
  CalendarClock,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Plus,
  Users,
} from "lucide-react";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { StaffTaskModal, type Performer } from "../_components/staff-task-modal";
import { mergeOrder, moveTo } from "@/lib/pool-order";
import { persistUiPref } from "@/lib/ui-prefs-client";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { AuthorBadge } from "@/components/author-badge";
import { STATUS_BAR, addDaysISO, formatDateShort, initials } from "@/lib/task-ui";
import { taskNumberLabel } from "@/lib/task-number";
import type { TaskDTO } from "@/lib/task-dto";

// Перетаскивание колонок — своим MIME, чтобы не путаться с карточками (те кладут id в text/plain).
const POOL_MIME = "application/x-vm-staff-pool";

// Хвост просрочки: задачу, не закрытую вчера, видно у исполнителя, а не только в архиве.
const OVERDUE_DAYS = 14;
// Горизонт пула «Ближайшие»: сегодня + 7 дней. Задачи цеха планируют на неделю вперёд.
const UPCOMING_DAYS = 7;

function todayISO(): string {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD в местной зоне
}

/**
 * «Цех» — доска второго контура задач (цех и снабжение), решение Артёма 15.08.2026.
 *
 * Устроена как «Водители», но проще: у этих задач нет ни адреса, ни оплаты, ни актов — только суть,
 * исполнитель и срок. Колонка исполнителя показывает ровно то же, что он видит у себя в телефоне
 * (сегодняшние + незакрытые просроченные + назначенные без даты), иначе доска и телефон разойдутся.
 *
 * Колонки — тот же «плотный пульт», что на доске водителей (16.08.2026): растягиваются на всю
 * ширину, шапка тащится за грип и подсвечивается при перетаскивании, порядок живёт в аккаунте.
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
        hint: "пул для планирования",
        icon: <CalendarOff className="h-4 w-4 text-slate-300" />,
        tasks: tasks.filter((t) => dayOf(t) === null && !t.assignee),
        target: null as string | null,
      };
    }
    if (poolKey === "upcoming") {
      return {
        poolKey,
        title: "Ближайшие",
        hint: "планирование",
        icon: <CalendarClock className="h-4 w-4 text-slate-300" />,
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
      // «сегодня» в шапке (16.08.2026): у колонки исполнителя рядом с пулом «Ближайшие» иначе не
      // видно, за какой день она отвечает — а это задачи на сегодня плюс незакрытые хвосты.
      hint: "сегодня",
      title: person?.name ?? "—",
      icon: null,
      // Парная задача (16.08.2026) видна у ОБОИХ: у напарника — зеркалом, как на доске водителей.
      tasks: tasks.filter((t) => (t.assignee?.id === id || t.coDriverId === id) && forToday(t)),
      target: id,
    };
  });

  const openCount = tasks.filter((t) => forToday(t) && isOpen(t)).length;
  const inWork = tasks.filter((t) => t.status === "IN_PROGRESS").length;

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Цех</h1>
          <p className="text-sm text-neutral-500">
            Задачи сотрудникам: цех и снабжение. Доставки — на вкладке «Водители».
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
              hint={pool.hint}
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
        <StaffTaskModal
          performers={performers}
          today={today}
          onClose={() => setCreateOpen(false)}
          onSaved={() => void mutate()}
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
  hint,
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
  hint?: string;
  icon: React.ReactNode;
  tasks: TaskDTO[];
  performerId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onReorder: (dragKey: string, targetKey: string) => void;
  onDropTask: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const [over, setOver] = useState(false); // подсветка drop-зоны карточек
  const [reorderOver, setReorderOver] = useState(false); // подсветка при перетаскивании колонки
  const droppable = performerId !== null;
  const isPerson = performerId !== null;

  // Шапка тащится сама (перестановка колонок) и принимает только такие же шапки — по своему MIME.
  // Курсор-«грабли» и подсветка обязательны: без них перетаскивание есть, но о нём никто не знает
  // (16.08.2026 — ровно так и вышло на первой версии доски цеха).
  const headProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(POOL_MIME, poolKey);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(POOL_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setReorderOver(true);
    },
    onDragLeave: () => setReorderOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(POOL_MIME)) return;
      e.preventDefault();
      setReorderOver(false);
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

  const ringCls = reorderOver ? "rounded-md ring-2 ring-slate-400" : "";

  // Свёрнутый пул — узкая полоса: перетаскивание, инициалы/иконка, счётчик, разворот по клику.
  if (collapsed) {
    return (
      <div
        className={cn("flex w-11 shrink-0 flex-col", ringCls)}
        data-testid={`staff-col-${poolKey}`}
        data-collapsed="true"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={`Развернуть пул «${title}»`}
          className="flex flex-1 cursor-grab flex-col items-center gap-2 rounded-md bg-slate-900 px-1 py-2 active:cursor-grabbing"
          data-testid={`staff-expand-${poolKey}`}
          {...headProps}
        >
          <ChevronRight className="h-4 w-4 text-slate-300" />
          {isPerson ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">
              {initials(title)}
            </span>
          ) : (
            (icon ?? null)
          )}
          <span className="text-xs font-semibold tabular-nums text-slate-300">{tasks.length}</span>
          <span className="mt-1 max-h-36 overflow-hidden text-xs font-medium text-white [writing-mode:vertical-rl]">
            {title}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn("flex min-w-[18rem] flex-1 flex-col", ringCls)}
      data-testid={`staff-col-${poolKey}`}
    >
      <div
        className="flex cursor-grab items-center gap-2 rounded-t-md bg-slate-900 px-2.5 py-2 active:cursor-grabbing"
        {...headProps}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-slate-500" />
        {isPerson ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">
            {initials(title)}
          </span>
        ) : (
          (icon ?? null)
        )}
        <span className="flex-1 truncate text-sm font-semibold text-white">{title}</span>
        <span className="shrink-0 text-xs text-slate-300">
          {hint ? `${hint} · ` : ""}
          {tasks.length}
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={`Свернуть пул «${title}»`}
          className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-slate-700 hover:text-white"
          data-testid={`staff-collapse-${poolKey}`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      <div
        className={cn(
          "flex min-h-32 flex-1 flex-col rounded-b-md border border-t-0 p-2 transition-colors",
          over ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white",
        )}
        {...bodyProps}
      >
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">Пусто</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tasks.map((t) => (
              <li key={t.id}>
                <StaffCard task={t} columnPerformerId={performerId} onOpen={() => onOpen(t.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StaffCard({
  task,
  columnPerformerId = null,
  onOpen,
}: {
  task: TaskDTO;
  columnPerformerId?: string | null; // чья колонка: у напарника карточка — «зеркало»
  onOpen: () => void;
}) {
  // Пара (16.08.2026, как на доске водителей): в колонке напарника карточка — зеркало (правда живёт
  // у ответственного, перетаскивать нельзя — двусмысленно), в остальных — обычная с бейджем пары.
  const isMirror = task.coDriverId !== null && columnPerformerId === task.coDriverId;
  const pairBadge = task.coDriverId
    ? isMirror
      ? `напарник · отв. ${task.assignee?.name ?? "—"}`
      : `в паре · ${task.coDriver?.name ?? ""}`
    : null;
  return (
    <div
      draggable={!isMirror}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      className="flex cursor-pointer items-stretch gap-2 overflow-hidden rounded border border-neutral-200 bg-white hover:bg-neutral-50"
      data-testid={isMirror ? "staff-card-mirror" : `staff-card-${task.number}`}
    >
      <span className={cn("w-1 shrink-0", STATUS_BAR[task.status])} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2 pr-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">{taskNumberLabel(task)}</span>
          {task.priority ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Срочно" />
          ) : null}
          <StatusBadge status={task.status} />
          <AuthorBadge name={task.createdBy?.name} />
        </div>
        <span className="truncate text-sm text-neutral-900">{task.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
          {task.scheduledDate ? <span>{formatDateShort(task.scheduledDate)}</span> : null}
          {task.timeFrom ? (
            <span>
              {task.timeFrom}
              {task.timeTo ? `–${task.timeTo}` : ""}
            </span>
          ) : null}
          {pairBadge ? (
            <Badge
              data-testid="staff-pair-badge"
              className="inline-flex items-center gap-1 border border-slate-400 text-slate-600"
            >
              <Users className="h-3 w-3" />
              {pairBadge}
            </Badge>
          ) : null}
        </span>
      </div>
    </div>
  );
}
