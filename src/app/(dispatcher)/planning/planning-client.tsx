"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, RefreshCw, Move, GripVertical } from "lucide-react";
import { fetcher, apiSend } from "@/lib/fetcher";
import { mergeOrder, moveTo } from "@/lib/pool-order";
import { persistUiPref } from "@/lib/ui-prefs-client";
import type { DriverDTO, TaskDTO } from "@/lib/task-dto";
import { STATUS_BAR, addDaysISO, formatDate } from "@/lib/task-ui";
import { parseQuery, taskMatches, type ParsedQuery } from "@/lib/task-search";
import { StatusBadge } from "@/components/status-badge";
import { formatMinutes } from "@/domain/capacity";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import { TaskSearchInput } from "../_components/task-search-input";
import { Highlighted } from "../_components/highlight";

const LIVE = { refreshInterval: 10_000, keepPreviousData: true, revalidateOnFocus: true } as const;
const HORIZON_DAYS = 7; // окно планирования — неделя (решение Артёма 17.06)
const TERMINAL = ["DONE", "CANCELLED"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
// Отдельный MIME-тип для перетаскивания СТРОК-пулов — чтобы не пересекаться с перетаскиванием
// карточек (те кладут id в "text/plain"). Ячейки читают только text/plain, drag строки их не трогает.
const ROW_MIME = "application/x-vm-row";

type Row = { key: string; label: string; driverId: string | null };

function dayHeader(iso: string): { wd: string; day: number } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return { wd: WD[d.getUTCDay()], day: d.getUTCDate() };
}

// Цвет индикатора загрузки ячейки по доле от рабочего дня (Фаза 2, §14.4).
function loadChipClass(minutes: number, workday: number): string {
  const pct = workday > 0 ? minutes / workday : 0;
  if (pct > 1) return "bg-red-50 text-red-700";
  if (pct >= 0.7) return "bg-amber-50 text-amber-700";
  return "bg-green-50 text-green-700";
}

export function PlanningClient({
  drivers,
  today,
  workdayMinutes,
  initialRowOrder = [],
}: {
  drivers: DriverDTO[];
  today: string;
  workdayMinutes: number;
  initialRowOrder?: string[];
}) {
  const [weekStart, setWeekStart] = useState(today);
  // Персональный порядок строк-пулов (сохраняется в аккаунте). При перезагрузке приходит с сервера.
  const [rowOrder, setRowOrder] = useState<string[]>(initialRowOrder);
  const weekEnd = addDaysISO(weekStart, HORIZON_DAYS - 1);
  const days = Array.from({ length: HORIZON_DAYS }, (_, i) => addDaysISO(weekStart, i));

  const key = `/api/tasks?dateFrom=${weekStart}&dateTo=${weekEnd}&includeUndated=1`;
  const { data: tasks, isLoading, error: loadError, mutate } = useSWR<TaskDTO[]>(key, fetcher, LIVE);
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useMemo(() => tasks ?? [], [tasks]);
  const dateOf = (t: TaskDTO): string | null => (t.scheduledDate ? t.scheduledDate.slice(0, 10) : null);

  // Умный поиск по сетке недели: клиентская фильтрация загруженных задач (как на «Сегодня»).
  const [searchText, setSearchText] = useState("");
  const searchQuery = useMemo(() => parseQuery(searchText), [searchText]);
  const searchActive = searchQuery.active;
  const matchedIds = useMemo(() => {
    if (!searchQuery.active) return null;
    return new Set(list.filter((t) => taskMatches(t, searchQuery)).map((t) => t.id));
  }, [list, searchQuery]);
  const bySearch = (arr: TaskDTO[]) => (matchedIds ? arr.filter((t) => matchedIds.has(t.id)) : arr);
  const foundCount = matchedIds ? matchedIds.size : null;

  const undated = bySearch(list.filter((t) => !t.scheduledDate));

  // Строки сетки: «Без водителя» (дата есть, исполнителя нет) + по строке на водителя.
  const rows: Row[] = [
    { key: "none", label: "Без водителя", driverId: null },
    ...drivers.map((d) => ({ key: d.id, label: d.name, driverId: d.id })),
  ];
  // Отображаемый порядок строк = сохранённый, сведённый к актуальному набору (новый водитель сам
  // встаёт в конец, пропавший отбрасывается). Перетаскивание меняет порядок и сохраняет его.
  const rowKeys = rows.map((r) => r.key);
  const displayRows = mergeOrder(rowOrder, rowKeys)
    .map((key) => rows.find((r) => r.key === key))
    .filter((r): r is Row => r !== undefined);

  function reorderRows(dragKey: string, targetKey: string) {
    setRowOrder((prev) => {
      const next = moveTo(mergeOrder(prev, rowKeys), dragKey, targetKey);
      persistUiPref("planning.order", next);
      return next;
    });
  }

  // Парная задача (20.07) видна в строках обоих водителей; в строке напарника — зеркало (не draggable).
  const cellTasks = (row: Row, day: string): TaskDTO[] =>
    bySearch(
      list.filter(
        (t) =>
          dateOf(t) === day &&
          (row.driverId === null
            ? (t.assigneeId ?? null) === null
            : t.assigneeId === row.driverId || t.coDriverId === row.driverId),
      ),
    );

  async function plan(taskId: string, day: string, assigneeId: string | null) {
    const task = list.find((t) => t.id === taskId);
    if (!task || TERMINAL.includes(task.status)) return;
    setActionError(null);
    try {
      await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "plan", scheduledDate: day, assigneeId });
      await mutate();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function toUndated(taskId: string) {
    const task = list.find((t) => t.id === taskId);
    if (!task || TERMINAL.includes(task.status)) return;
    setActionError(null);
    try {
      await apiSend(`/api/tasks/${taskId}`, "PATCH", { op: "edit", scheduledDate: null });
      await mutate();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  const firstLoad = isLoading && !tasks;
  const staleError = loadError && tasks;

  return (
    <div className="p-4" data-testid="planning">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">Планирование</h1>
        <TaskSearchInput value={searchText} onChange={setSearchText} found={foundCount} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Предыдущая неделя"
            data-testid="plan-prev"
            onClick={() => setWeekStart((w) => addDaysISO(w, -HORIZON_DAYS))}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-40 text-center text-sm font-medium text-neutral-700">
            {formatDate(weekStart)} — {formatDate(weekEnd)}
          </span>
          <button
            type="button"
            aria-label="Следующая неделя"
            data-testid="plan-next"
            onClick={() => setWeekStart((w) => addDaysISO(w, HORIZON_DAYS))}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <Button variant="secondary" onClick={() => setWeekStart(today)}>
            Сегодня
          </Button>
        </div>
      </div>

      <p className="mb-3 flex items-center gap-1.5 text-xs text-neutral-400">
        <Move className="h-3.5 w-3.5" /> перетащите карточку в ячейку — задаёт день и водителя; в «Без
        даты» — снимает дату. Метку строки слева можно перетащить, чтобы поменять строки местами
      </p>

      {actionError ? <p className="mb-3 text-sm text-red-600">{actionError}</p> : null}
      {staleError ? (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-amber-700">
          <RefreshCw className="h-3.5 w-3.5" /> Не удалось обновить — показаны последние данные.
        </p>
      ) : null}

      {firstLoad ? (
        <PlanningSkeleton rowCount={rows.length} />
      ) : loadError && !tasks ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">Не удалось загрузить планирование.</p>
          <Button variant="secondary" className="mt-3" onClick={() => void mutate()}>
            <RefreshCw className="h-4 w-4" /> Повторить
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto pb-3">
            <div
              data-testid="plan-grid"
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `132px repeat(${HORIZON_DAYS}, minmax(116px, 1fr))`, minWidth: 132 + HORIZON_DAYS * 116 }}
            >
              {/* Шапка дней */}
              <div />
              {days.map((d) => {
                const h = dayHeader(d);
                const isToday = d === today;
                return (
                  <div
                    key={`h-${d}`}
                    className={`rounded-md px-1 py-1 text-center text-xs font-medium ${
                      isToday ? "bg-blue-50 text-blue-800" : "text-neutral-500"
                    }`}
                  >
                    {h.wd} {h.day}
                    {isToday ? " · сегодня" : ""}
                  </div>
                );
              })}

              {/* Строки в персональном порядке. Левую метку можно перетащить, чтобы поменять
                  строки-пулы местами (порядок сохраняется в аккаунте). */}
              {displayRows.map((row) => (
                <RowCells
                  key={row.key}
                  row={row}
                  days={days}
                  today={today}
                  cellTasks={cellTasks}
                  onPlan={plan}
                  workdayMinutes={workdayMinutes}
                  onReorder={reorderRows}
                  searchQuery={searchActive ? searchQuery : null}
                />
              ))}
            </div>
          </div>

          {/* Пул «Без даты» */}
          <UndatedPool
            tasks={undated}
            onDropUndated={toUndated}
            searchQuery={searchActive ? searchQuery : null}
          />
        </>
      )}
    </div>
  );
}

function RowCells({
  row,
  days,
  today,
  cellTasks,
  onPlan,
  workdayMinutes,
  onReorder,
  searchQuery = null,
}: {
  row: Row;
  days: string[];
  today: string;
  cellTasks: (row: Row, day: string) => TaskDTO[];
  onPlan: (taskId: string, day: string, assigneeId: string | null) => void;
  workdayMinutes: number;
  onReorder: (dragKey: string, targetKey: string) => void;
  searchQuery?: ParsedQuery | null;
}) {
  const [reorderOver, setReorderOver] = useState(false);
  return (
    <>
      {/* Левая метка — ручка перетаскивания строки (reorder). Свой MIME-тип, не пересекается с
          перетаскиванием карточек (те читают text/plain). */}
      <div
        draggable
        data-testid={`row-handle-${row.key}`}
        onDragStart={(e) => {
          e.dataTransfer.setData(ROW_MIME, row.key);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ROW_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setReorderOver(true);
        }}
        onDragLeave={() => setReorderOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(ROW_MIME)) return;
          e.preventDefault();
          setReorderOver(false);
          const dragKey = e.dataTransfer.getData(ROW_MIME);
          if (dragKey) onReorder(dragKey, row.key);
        }}
        className={`flex cursor-grab items-center gap-1 rounded px-1 text-xs font-medium text-neutral-700 active:cursor-grabbing ${
          reorderOver ? "ring-2 ring-neutral-400" : ""
        }`}
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
        <span className="truncate">{row.label}</span>
      </div>
      {days.map((day) => (
        <Cell
          key={`${row.key}-${day}`}
          rowKey={row.key}
          day={day}
          isToday={day === today}
          tasks={cellTasks(row, day)}
          onDropTask={(taskId) => onPlan(taskId, day, row.driverId)}
          // Индикатор загрузки — только в строках водителей (в «Без водителя» он не имеет смысла).
          // При активном поиске чип скрываем: сумма по отфильтрованным карточкам врала бы про день.
          showLoad={row.driverId !== null && searchQuery === null}
          workdayMinutes={workdayMinutes}
          searchQuery={searchQuery}
          rowDriverId={row.driverId}
        />
      ))}
    </>
  );
}

function Cell({
  rowKey,
  day,
  isToday,
  tasks,
  onDropTask,
  showLoad,
  workdayMinutes,
  searchQuery = null,
  rowDriverId = null,
}: {
  rowKey: string;
  day: string;
  isToday: boolean;
  tasks: TaskDTO[];
  onDropTask: (taskId: string) => void;
  showLoad: boolean;
  workdayMinutes: number;
  searchQuery?: ParsedQuery | null;
  rowDriverId?: string | null;
}) {
  const [over, setOver] = useState(false);
  // Сумма оценок задач ячейки (Фаза 2, §14.4) — из уже загруженных задач, без доп. запроса.
  const loadMinutes = tasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  return (
    <div
      data-testid={`cell-${rowKey}-${day}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ROW_MIME)) return; // перетаскивание строки — не для ячейки
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTask(id);
      }}
      className={`flex min-h-16 flex-col gap-1 rounded-md border p-1 transition-colors ${
        over
          ? "border-neutral-400 bg-neutral-100"
          : isToday
            ? "border-blue-100 bg-blue-50/40"
            : "border-neutral-200 bg-neutral-50"
      }`}
    >
      {showLoad && tasks.length > 0 ? (
        <div
          data-testid="cell-load"
          className={`flex items-center justify-between rounded px-1 text-[10px] font-medium ${loadChipClass(
            loadMinutes,
            workdayMinutes,
          )}`}
        >
          <span>≈ {formatMinutes(loadMinutes)}</span>
          <span>{tasks.length} зад.</span>
        </div>
      ) : null}
      {tasks.map((t) => (
        <PlanCard key={t.id} task={t} query={searchQuery} rowDriverId={rowDriverId} />
      ))}
    </div>
  );
}

function PlanCard({
  task,
  query = null,
  rowDriverId = null,
}: {
  task: TaskDTO;
  query?: ParsedQuery | null;
  rowDriverId?: string | null; // чья строка: у напарника карточка-зеркало (не draggable)
}) {
  const router = useRouter();
  const isMirror = task.coDriverId !== null && rowDriverId === task.coDriverId;
  const draggable = !TERMINAL.includes(task.status) && !isMirror;
  // Провал в заявку — кликом по любой части плашки (решение Артёма 02.07.2026).
  const openTask = () => router.push(`/tasks/${task.id}`);
  return (
    <div
      draggable={draggable}
      data-testid={isMirror ? "plan-card-mirror" : "plan-card"}
      role="link"
      tabIndex={0}
      aria-label={`Заявка №${task.number}: ${task.title}`}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
      onClick={openTask}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTask();
        }
      }}
      className={`relative cursor-pointer rounded border border-neutral-200 bg-white p-1 pl-2 text-xs shadow-sm hover:bg-neutral-50 ${
        draggable ? "active:cursor-grabbing" : "opacity-70"
      }`}
    >
      <span className={`absolute left-0 top-0 h-full w-1 rounded-l ${STATUS_BAR[task.status]}`} />
      <span className="flex items-center gap-1 font-medium text-neutral-900">
        <TypeIcon name={task.type.icon} className="h-3.5 w-3.5 text-neutral-500" />№
        <Highlighted text={String(task.number)} query={query} />
        {task.priority ? <span className="text-red-500">●</span> : null}
      </span>
      <span className="mt-0.5 block truncate text-neutral-700">
        <Highlighted text={task.title} query={query} />
      </span>
      {isMirror ? (
        <span className="mt-0.5 inline-block rounded border border-neutral-300 px-1 text-[10px] leading-4 text-neutral-500">
          напарник
        </span>
      ) : task.coDriver ? (
        <span className="mt-0.5 inline-block truncate rounded border border-neutral-300 px-1 text-[10px] leading-4 text-neutral-500">
          в паре · {task.coDriver.name}
        </span>
      ) : null}
      {task.timeFrom || task.timeTo ? (
        <span className="text-neutral-500">
          {task.timeFrom ?? ""}
          {task.timeTo ? `–${task.timeTo}` : ""}
        </span>
      ) : null}
      <StatusBadge status={task.status} className="mt-0.5" />
    </div>
  );
}

function UndatedPool({
  tasks,
  onDropUndated,
  searchQuery = null,
}: {
  tasks: TaskDTO[];
  onDropUndated: (taskId: string) => void;
  searchQuery?: ParsedQuery | null;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid="plan-undated"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ROW_MIME)) return; // перетаскивание строки — не для пула
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropUndated(id);
      }}
      className={`rounded-xl border p-2 transition-colors ${
        over ? "border-neutral-400 bg-neutral-100" : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <div className="mb-1.5 px-1 text-xs font-semibold text-neutral-600">Без даты · {tasks.length}</div>
      {tasks.length === 0 ? (
        <p className="px-1 py-2 text-center text-xs text-neutral-400">
          {searchQuery ? "Нет совпадений" : "Пусто"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="w-44">
              <PlanCard task={t} query={searchQuery} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanningSkeleton({ rowCount }: { rowCount: number }) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      {Array.from({ length: rowCount + 1 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-neutral-100" />
      ))}
    </div>
  );
}
