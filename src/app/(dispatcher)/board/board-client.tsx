"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Plus,
  AlertTriangle,
  RefreshCw,
  CalendarOff,
  CalendarClock,
  GripVertical,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { fetcher, apiSend } from "@/lib/fetcher";
import { mergeOrder, moveTo } from "@/lib/pool-order";
import { persistUiPref } from "@/lib/ui-prefs-client";
import type { AttentionDTO, DriverDTO, TaskDTO, TaskTypeDTO } from "@/lib/task-dto";
import {
  STATUS_BADGE,
  STATUS_BAR,
  STATUS_LABEL,
  PASS_BADGE,
  PASS_LABEL,
  actBadge,
  addDaysISO,
  formatDate,
  formatDateShort,
} from "@/lib/task-ui";
import { actState } from "@/domain/act";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateTaskModal } from "../_components/create-task-modal";

type DropTarget = { kind: "driver"; driverId: string } | { kind: "undated" };

// Отдельный MIME-тип для перетаскивания ПУЛОВ (колонок) — чтобы не пересекаться с перетаскиванием
// карточек задач (те кладут id в "text/plain"). Drop карточки на тело колонки читает только text/plain,
// поэтому drag пула по телу колонки ничего не назначает; reorder ловится на шапке по этому типу.
const POOL_MIME = "application/x-vm-pool";

// Горизонт пула «Ближайшие 3 дня»: сегодня + 2 дня (решение Артёма 17.06).
const HORIZON_DAYS = 2;

// Опции живого обновления (Этап 6): поллинг 10 с; keepPreviousData держит прошлые данные во время
// фонового запроса — раскладка не дёргается, скелетоны только на самой первой загрузке.
const LIVE = { refreshInterval: 10_000, keepPreviousData: true, revalidateOnFocus: true } as const;

// Описание пула-колонки, не зависящее от раскладки: заголовок, иконка, задачи, drop-цель.
type PoolDescriptor = {
  poolKey: string;
  title: string;
  hint?: string;
  headIcon?: React.ReactNode;
  isDriver?: boolean;
  tasks: TaskDTO[];
  target?: DropTarget;
  showDate?: boolean;
};

// Инициалы водителя для аватара в графитовой шапке колонки: «Алексей Каширский» → «АК».
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function BoardClient({
  drivers,
  types,
  today,
  initialOrder = [],
  initialCollapsed = [],
}: {
  drivers: DriverDTO[];
  types: TaskTypeDTO[];
  today: string;
  initialOrder?: string[];
  initialCollapsed?: string[];
}) {
  // Выборка для доски: задачи сегодня…+2 + пул «Без даты» (одним запросом, фильтрация — на клиенте).
  const horizonEnd = addDaysISO(today, HORIZON_DAYS);
  const key = `/api/tasks?dateFrom=${today}&dateTo=${horizonEnd}&includeUndated=1`;
  const { data: tasks, isLoading, error: loadError, mutate } = useSWR<TaskDTO[]>(key, fetcher, LIVE);
  const { data: attention, mutate: mutateAttention } = useSWR<AttentionDTO>(
    `/api/board/attention?date=${today}`,
    fetcher,
    LIVE,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Персональная раскладка пулов (сохраняется в аккаунте). order — заданный диспетчером порядок
  // ключей пулов; collapsed — множество свёрнутых. При перезагрузке приходят с сервера (props).
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(initialCollapsed));

  // Ключи всех пулов в естественном порядке: служебные + по водителю. Стабильные id для раскладки.
  const poolKeys = useMemo(
    () => ["undated", "upcoming", ...drivers.map((d) => `driver:${d.id}`)],
    [drivers],
  );

  function handleReorder(dragKey: string, targetKey: string) {
    setOrder((prev) => {
      const next = moveTo(mergeOrder(prev, poolKeys), dragKey, targetKey);
      persistUiPref("board.order", next);
      return next;
    });
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistUiPref("board.collapsed", [...next]);
      return next;
    });
  }

  const list = tasks ?? [];
  const dateOf = (t: TaskDTO): string | null => (t.scheduledDate ? t.scheduledDate.slice(0, 10) : null);

  const undated = list.filter((t) => !t.scheduledDate);
  const todays = list.filter((t) => dateOf(t) === today);
  // Пул «Ближайшие 3 дня»: сегодня — только нераспределённые (назначенные уже стоят в колонках
  // водителей, дубля карточек не будет); завтра и послезавтра — все задачи (и назначенные).
  const upcoming = list.filter((t) => {
    const d = dateOf(t);
    if (!d) return false;
    if (d === today) return !t.assigneeId;
    return d > today && d <= horizonEnd;
  });

  const total = todays.length;
  const inWork = todays.filter((t) => ["ACCEPTED", "EN_ROUTE", "ON_SITE"].includes(t.status)).length;
  const done = todays.filter((t) => t.status === "DONE").length;
  const unassignedTodayCount = todays.filter((t) => !t.assigneeId).length;
  const attentionCount = (attention?.overdue.length ?? 0) + (attention?.tomorrowPasses.length ?? 0);

  // Обновить разом обе ленты (после перетаскивания/назначения «внимание» тоже могло измениться).
  const refresh = () => Promise.all([mutate(), mutateAttention()]);

  async function onDrop(taskId: string, target: DropTarget) {
    const task = list.find((t) => t.id === taskId);
    if (!task) return;
    setActionError(null);
    try {
      if (target.kind === "undated") {
        await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "edit", scheduledDate: null });
      } else {
        // Авто-простановку даты при назначении задачи без даты делает сервер (assignTask, п.1):
        // одна ручка, today передаём для корректной локальной даты.
        await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "assign", assigneeId: target.driverId, today });
      }
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function quickAssign(taskId: string, assigneeId: string) {
    setActionError(null);
    try {
      await apiSend(`/api/tasks/${taskId}`, "PATCH", {
        op: "assign",
        assigneeId: assigneeId || null,
        today,
      });
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  const firstLoad = isLoading && !tasks;
  // Ошибка фонового обновления, но данные уже есть — показываем спокойный индикатор, не сносим доску.
  const staleError = loadError && tasks;

  // Порядок отображения = сохранённый порядок, сведённый к актуальному набору пулов (новый водитель
  // появляется сам, пропавший отбрасывается). Дескриптор пула собирается по ключу.
  const displayOrder = mergeOrder(order, poolKeys);
  const poolByKey = (key: string): PoolDescriptor | null => {
    if (key === "undated") {
      return {
        poolKey: key,
        title: "Без даты",
        hint: "пул для планирования",
        headIcon: <CalendarOff className="h-4 w-4 text-slate-300" />,
        tasks: undated,
        target: { kind: "undated" },
      };
    }
    if (key === "upcoming") {
      return {
        poolKey: key,
        title: "Ближайшие 3 дня",
        hint: "планирование",
        headIcon: <CalendarClock className="h-4 w-4 text-slate-300" />,
        tasks: upcoming,
        showDate: true,
      };
    }
    if (key.startsWith("driver:")) {
      const d = drivers.find((x) => x.id === key.slice("driver:".length));
      if (!d) return null;
      return {
        poolKey: key,
        title: d.name,
        isDriver: true,
        tasks: todays.filter((t) => t.assigneeId === d.id),
        target: { kind: "driver", driverId: d.id },
      };
    }
    return null;
  };

  return (
    <div className="p-4" data-testid="board">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">Сегодня · {formatDate(today)}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Задача
        </Button>
      </div>

      {/* Счётчики (PRD §8, ui-guidelines): всего / в работе / выполнено / требуют внимания.
          Бесцветные графитовые плашки; цветом подсвечивается только число — «выполнено» зелёным,
          «требуют внимания» янтарным (когда есть). */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Stat label="Всего" value={total} />
        <Stat label="В работе" value={inWork} />
        <Stat label="Выполнено" value={done} tone="green" />
        <Stat
          label="Требуют внимания"
          value={attentionCount}
          tone={attentionCount > 0 ? "amber" : "neutral"}
          testId="stat-attention"
          onClick={attentionCount > 0 ? () => scrollToAttention() : undefined}
        />
        <Stat label="Не назначено сегодня" value={unassignedTodayCount} tone="muted" />
      </div>

      {actionError ? <p className="mb-3 text-sm text-red-600">{actionError}</p> : null}
      {staleError ? (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-amber-700">
          <RefreshCw className="h-3.5 w-3.5" /> Не удалось обновить — показаны последние данные.
        </p>
      ) : null}

      {/* Первая загрузка — скелетон (без дёрганья на последующих поллингах) */}
      {firstLoad ? (
        <BoardSkeleton driverCount={drivers.length} />
      ) : loadError && !tasks ? (
        <ErrorState onRetry={() => void refresh()} />
      ) : (
        <>
          {attentionCount > 0 && attention ? <AttentionBlock attention={attention} /> : null}

          {/* Пулы в персональном порядке. Шапку можно перетащить, чтобы поменять пулы местами;
              стрелка в шапке сворачивает пул в узкую полосу — остальные расширяются. */}
          <div className="flex gap-3 overflow-x-auto pb-4" data-testid="board-columns">
            {displayOrder.map((key) => {
              const p = poolByKey(key);
              if (!p) return null;
              return (
                <Column
                  key={key}
                  poolKey={p.poolKey}
                  title={p.title}
                  hint={p.hint}
                  headIcon={p.headIcon}
                  isDriver={p.isDriver}
                  tasks={p.tasks}
                  drivers={drivers}
                  target={p.target}
                  showDate={p.showDate}
                  onDropTask={onDrop}
                  onQuickAssign={quickAssign}
                  collapsed={collapsed.has(key)}
                  onToggleCollapse={() => toggleCollapse(key)}
                  onReorder={handleReorder}
                />
              );
            })}
          </div>
        </>
      )}

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        types={types}
        drivers={drivers}
        defaultDate={today}
        onCreated={() => void refresh()}
      />
    </div>
  );
}

function scrollToAttention() {
  document.getElementById("attention")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Stat({
  label,
  value,
  tone = "neutral",
  onClick,
  testId,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "green" | "amber" | "muted";
  onClick?: () => void;
  testId?: string;
}) {
  // Плашка всегда нейтральная белая; цвет несёт только число.
  const numTone: Record<string, string> = {
    neutral: "text-slate-900",
    green: "text-green-600",
    amber: "text-amber-700",
    muted: "text-slate-400",
  };
  const className = `flex items-baseline gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm ${
    onClick ? "cursor-pointer hover:bg-slate-50" : ""
  }`;
  const content = (
    <>
      <span className="text-xs text-slate-500">{label}</span>
      <b className={`text-base tabular-nums ${numTone[tone]}`}>{value}</b>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className} data-testid={testId}>
      {content}
    </button>
  ) : (
    <div className={className} data-testid={testId}>
      {content}
    </div>
  );
}

function AttentionBlock({ attention }: { attention: AttentionDTO }) {
  return (
    <section
      id="attention"
      data-testid="attention-block"
      className="mb-4 rounded-md border border-slate-900 bg-white p-3"
    >
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <AlertTriangle className="h-4 w-4" /> Требуют внимания
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {/* Сначала пропуска на завтра — их надо заказать сегодня */}
        {attention.tomorrowPasses.map((t) => (
          <AttentionItem
            key={`pass-${t.id}`}
            task={t}
            chip={
              <Badge className="border border-amber-500 text-amber-700">
                Пропуск на завтра не заказан
              </Badge>
            }
          />
        ))}
        {attention.overdue.map((t) => (
          <AttentionItem
            key={`overdue-${t.id}`}
            task={t}
            chip={
              <Badge className="border border-red-600 text-red-700">
                Просрочено · {formatDateShort(t.scheduledDate)}
              </Badge>
            }
          />
        ))}
      </div>
    </section>
  );
}

function AttentionItem({ task, chip }: { task: TaskDTO; chip: React.ReactNode }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 hover:border-slate-300"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-900">
          <TypeIcon name={task.type.icon} className="h-4 w-4 text-slate-500" />№{task.number}
          {task.priority ? <span className="text-red-500">●</span> : null}
        </span>
        <Badge className={STATUS_BADGE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
      </div>
      <span className="truncate text-sm text-slate-800">{task.title}</span>
      <span className="truncate text-xs text-slate-500">
        {task.assignee?.name ?? "Не назначено"} · {task.address}
      </span>
      <span>{chip}</span>
    </Link>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-6 text-center">
      <p className="text-sm text-red-700">Не удалось загрузить доску.</p>
      <Button variant="secondary" className="mt-3" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" /> Повторить
      </Button>
    </div>
  );
}

function BoardSkeleton({ driverCount }: { driverCount: number }) {
  const columns = driverCount + 2; // «Без даты» + «Ближайшие 3 дня» + водители
  return (
    <div className="flex gap-3 overflow-x-auto pb-4" aria-hidden>
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="flex min-w-[18rem] flex-1 flex-col">
          <div className="h-9 rounded-t-md bg-slate-900" />
          <div className="flex min-h-32 flex-1 flex-col gap-2 rounded-b-md border border-t-0 border-slate-200 bg-white p-2">
            <div className="h-16 animate-pulse rounded bg-slate-100" />
            <div className="h-16 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Column({
  poolKey,
  title,
  hint,
  headIcon,
  isDriver = false,
  tasks,
  drivers,
  target,
  showDate = false,
  onDropTask,
  onQuickAssign,
  collapsed,
  onToggleCollapse,
  onReorder,
}: {
  poolKey: string;
  title: string;
  hint?: string;
  headIcon?: React.ReactNode;
  isDriver?: boolean;
  tasks: TaskDTO[];
  drivers: DriverDTO[];
  target?: DropTarget; // без target — колонка только показ/источник (пул «Ближайшие 3 дня»)
  showDate?: boolean;
  onDropTask?: (taskId: string, target: DropTarget) => void;
  onQuickAssign: (taskId: string, assigneeId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onReorder: (dragKey: string, targetKey: string) => void;
}) {
  const [over, setOver] = useState(false); // подсветка drop-зоны карточек
  const [reorderOver, setReorderOver] = useState(false); // подсветка drop-зоны перетаскивания пула
  const droppable = target !== undefined && onDropTask !== undefined;
  const testId = target
    ? target.kind === "driver"
      ? `col-driver-${target.driverId}`
      : `col-${target.kind}`
    : "col-upcoming";

  // Перетаскивание пула (reorder): кладём ключ в свой MIME-тип, отличный от карточек ("text/plain").
  const headDragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(POOL_MIME, poolKey);
      e.dataTransfer.effectAllowed = "move";
    },
  };
  // Шапка — drop-зона reorder: реагирует ТОЛЬКО на перетаскивание пула (по типу), не на карточки.
  const headDropProps = {
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

  // Drop-зона карточек — только у развёрнутой droppable-колонки; перетаскивание пула сюда игнорируем.
  const dropProps =
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
            if (id && target && onDropTask) onDropTask(id, target);
          },
        }
      : {};

  const ringCls = reorderOver ? "rounded-md ring-2 ring-slate-400" : "";

  // Свёрнутый пул — узкая полоса: грип-перетаскивание, иконка/инициалы, счётчик, разворот по клику.
  if (collapsed) {
    return (
      <div data-testid={testId} data-collapsed="true" className={`flex w-11 shrink-0 flex-col ${ringCls}`}>
        <button
          type="button"
          {...headDragProps}
          {...headDropProps}
          onClick={onToggleCollapse}
          aria-label={`Развернуть пул «${title}»`}
          data-testid={`col-expand-${poolKey}`}
          className="flex flex-1 cursor-grab flex-col items-center gap-2 rounded-md bg-slate-900 px-1 py-2 active:cursor-grabbing"
        >
          <ChevronRight className="h-4 w-4 text-slate-300" />
          {isDriver ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">
              {initials(title)}
            </span>
          ) : (
            headIcon ?? null
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
    <div className={`flex min-w-[18rem] flex-1 flex-col ${ringCls}`} data-testid={testId}>
      {/* Графитовая шапка: грип (перетащить пул), аватар/иконка, заголовок, счётчик, кнопка свернуть. */}
      <div
        {...headDragProps}
        {...headDropProps}
        className="flex cursor-grab items-center gap-2 rounded-t-md bg-slate-900 px-2.5 py-2 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4 shrink-0 text-slate-500" />
        {isDriver ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">
            {initials(title)}
          </span>
        ) : (
          headIcon ?? null
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
          data-testid={`col-collapse-${poolKey}`}
          className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-slate-700 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      <div
        {...dropProps}
        className={`flex min-h-32 flex-1 flex-col rounded-b-md border border-t-0 transition-colors ${
          over ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white"
        }`}
      >
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">Пусто</p>
        ) : (
          tasks.map((t) => (
            <BoardCard
              key={t.id}
              task={t}
              drivers={drivers}
              showDate={showDate}
              showAssign={!isDriver}
              onQuickAssign={onQuickAssign}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BoardCard({
  task,
  drivers,
  showDate = false,
  showAssign = false,
  onQuickAssign,
}: {
  task: TaskDTO;
  drivers: DriverDTO[];
  showDate?: boolean;
  showAssign?: boolean; // селект-исполнитель показываем только в пулах (в колонке водителя он лишний)
  onQuickAssign: (taskId: string, assigneeId: string) => void;
}) {
  const hasTime = task.timeFrom || task.timeTo || task.timeNote;
  // Признак комплектности акта на доске (этап 14, «хвост»): показываем ТОЛЬКО на завершённой актовой
  // задаче — это сигнал Милене «акт приложен ✓ / не приложен». На текущих задачах акт ещё рано — не шумим.
  const actSt = actState({
    requiresSignedDoc: task.requiresSignedDoc,
    actWaivedNote: task.actWaivedNote,
    hasSignedDoc: task.hasSignedDoc ?? false,
  });
  const act = task.status === "DONE" && (actSt === "COMPLETE" || actSt === "PENDING") ? actBadge(actSt, true) : null;
  return (
    <div
      draggable
      data-testid="board-card"
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
      className="relative cursor-grab border-b border-slate-200 bg-white py-1.5 pl-3 pr-2 last:border-b-0 hover:bg-slate-50 active:cursor-grabbing"
    >
      <span className={`absolute left-0 top-0 h-full w-[3px] ${STATUS_BAR[task.status]}`} />
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/tasks/${task.id}`}
          className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-900 hover:underline"
        >
          <TypeIcon name={task.type.icon} className="h-4 w-4 shrink-0 text-slate-500" />№{task.number}
          {task.priority ? <span className="text-red-500">●</span> : null}
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* В пуле «Ближайшие 3 дня» показываем день — задачи разных дат вперемешку. */}
          {showDate && task.scheduledDate ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-600">
              {formatDateShort(task.scheduledDate)}
            </span>
          ) : null}
          <Badge className={STATUS_BADGE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
        </div>
      </div>
      <Link
        href={`/tasks/${task.id}`}
        className="mt-0.5 block truncate text-sm text-slate-800 hover:underline"
      >
        {task.title}
      </Link>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-slate-500">{task.address}</p>
        {hasTime ? (
          <p className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-500">
            {task.timeFrom || task.timeTo ? `${task.timeFrom ?? ""}–${task.timeTo ?? ""} ` : ""}
            {task.timeNote ?? ""}
          </p>
        ) : null}
      </div>
      {task.passStatus !== "NOT_NEEDED" || act ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {task.passStatus !== "NOT_NEEDED" ? (
            <Badge className={PASS_BADGE[task.passStatus]}>{PASS_LABEL[task.passStatus]}</Badge>
          ) : null}
          {act ? <Badge className={act.className}>{act.label}</Badge> : null}
        </div>
      ) : null}
      {showAssign ? (
        <select
          value={task.assigneeId ?? ""}
          onChange={(e) => onQuickAssign(task.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="mt-1.5 h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-600 outline-none"
        >
          <option value="">— не назначено —</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
