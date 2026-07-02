"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Plus,
  AlertTriangle,
  RefreshCw,
  CalendarOff,
  CalendarClock,
  Clock,
  GripVertical,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { fetcher, apiSend } from "@/lib/fetcher";
import { mergeOrder, moveTo } from "@/lib/pool-order";
import { persistUiPref } from "@/lib/ui-prefs-client";
import type { AttentionDTO, DriverDTO, TaskDTO, TaskTypeDTO } from "@/lib/task-dto";
import type { IdleNoteView } from "@/lib/idle-note-dto";
import { Modal } from "@/components/ui/modal";
import {
  STATUS_BAR,
  PASS_BADGE,
  PASS_LABEL,
  actBadge,
  addDaysISO,
  formatDate,
  formatDateShort,
} from "@/lib/task-ui";
import { actState } from "@/domain/act";
import { TypeIcon } from "@/components/type-icon";
import { StatusBadge } from "@/components/status-badge";
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
  // Смены за день (этап C): запросы на открытие, которые диспетчер подтверждает.
  const { data: shifts, mutate: mutateShifts } = useSWR<ShiftDTO[]>(
    `/api/shifts?date=${today}`,
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
  const inWork = todays.filter((t) => t.status === "IN_PROGRESS").length;
  const done = todays.filter((t) => t.status === "DONE").length;
  const unassignedTodayCount = todays.filter((t) => !t.assigneeId).length;
  const attentionCount = (attention?.overdue.length ?? 0) + (attention?.tomorrowPasses.length ?? 0);
  const requestedShifts = (shifts ?? []).filter((s) => s.status === "REQUESTED");

  // Обновить разом ленты (после перетаскивания/назначения/подтверждения смены данные могли измениться).
  const refresh = () => Promise.all([mutate(), mutateAttention(), mutateShifts()]);

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

      {/* Смены водителей (№5): по каждому — статус смены, время открытия и полоса «в работе/простой». */}
      <ShiftWorkloadBlock drivers={drivers} shifts={shifts ?? []} today={today} onChange={refresh} />

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
          {requestedShifts.length > 0 ? (
            <ShiftsBlock shifts={requestedShifts} onChange={refresh} />
          ) : null}

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

type ShiftDTO = {
  id: string;
  driverId: string;
  driverName: string | null;
  status: "REQUESTED" | "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  openedAtAdjustNote: string | null; // если время правили — причина (№3)
  workedMinutes?: number; // отработано за день по задачам (для полосы, №5)
};

// «чч:мм» из ISO в местной зоне (время открытия смены).
function shiftHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Блок «Открытие смен» (этап C): запросы водителей на открытие смены, которые диспетчер подтверждает
// (он на базе и видит приход). Янтарный — требует действия сейчас (ui-guidelines).
function ShiftsBlock({
  shifts,
  onChange,
}: {
  shifts: ShiftDTO[];
  onChange: () => Promise<unknown>;
}) {
  return (
    <section
      data-testid="shifts-block"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3"
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
        <Clock className="h-4 w-4" /> Открытие смен — подтвердите приход
      </h2>
      <ul className="flex flex-col gap-2">
        {shifts.map((s) => (
          <ShiftConfirmRow key={s.id} shift={s} onChange={onChange} />
        ))}
      </ul>
    </section>
  );
}

// Строка подтверждения смены с возможностью поправить время открытия (№3): на случай «не было связи /
// сел телефон» диспетчер вводит фактическое время + причину. Без правки — обычное подтверждение.
function ShiftConfirmRow({ shift, onChange }: { shift: ShiftDTO; onChange: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState(shiftHHMM(shift.openedAt));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirm(withAdjust: boolean) {
    setError(null);
    if (withAdjust && !reason.trim()) {
      setError("Укажите причину правки времени");
      return;
    }
    setBusy(true);
    try {
      const body = withAdjust ? { openedAtTime: time, reason } : {};
      await apiSend(`/api/shifts/${shift.id}/confirm`, "POST", body);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-neutral-800">
          {shift.driverName ?? "Водитель"} · открыл в {shiftHHMM(shift.openedAt)}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditing((v) => !v)} disabled={busy}>
            {editing ? "Отмена" : "Поправить время"}
          </Button>
          {!editing ? (
            <Button onClick={() => void confirm(false)} disabled={busy}>
              Подтвердить
            </Button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2">
          <p className="text-xs text-slate-500">
            Если связи не было или сел телефон — укажите фактическое время открытия и причину.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-8 rounded border border-slate-200 px-2 text-sm tabular-nums"
              aria-label="Фактическое время открытия"
            />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина (напр. не было связи)"
              className="h-8 min-w-[12rem] flex-1 rounded border border-slate-200 px-2 text-sm"
            />
            <Button onClick={() => void confirm(true)} disabled={busy}>
              Подтвердить с правкой
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

// Длительность в человекочитаемом виде: «2 ч 15 мин» / «40 мин».
function fmtDur(min: number): string {
  if (min <= 0) return "0 мин";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

// Чип статуса смены для блока «Смены водителей» (№5). Цвет = смысл (ui-guidelines).
function shiftChip(shift: ShiftDTO | null): { label: string; cls: string } {
  const base = "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ";
  if (!shift) return { label: "Смена не открыта", cls: base + "bg-slate-100 text-slate-500" };
  if (shift.status === "REQUESTED") return { label: "Ждёт подтверждения", cls: base + "bg-amber-100 text-amber-700" };
  if (shift.status === "OPEN") return { label: "Открыта", cls: base + "bg-green-100 text-green-700" };
  return { label: "Закрыта", cls: base + "bg-slate-100 text-slate-500" };
}

// Блок «Смены водителей» (№5): по каждому водителю статус смены, время открытия и заполняющаяся
// полоса рабочего времени — «в работе» (зелёным) и «простой» (серым) от длительности смены.
// Пометки о простое (02.07): кнопка «Простой» открывает модалку внесения/разбора; метка с суммой
// минут за день. Водитель пометок не видит (диспетчерские ручки).
function ShiftWorkloadBlock({
  drivers,
  shifts,
  today,
  onChange,
}: {
  drivers: DriverDTO[];
  shifts: ShiftDTO[];
  today: string;
  onChange: () => Promise<unknown>;
}) {
  // «Сейчас» для живой полосы открытой смены — тикает раз в 30 с (поллинг доски тоже перерисует).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // Пометки о простое за сегодня (02.07) — метка в строке + список в модалке.
  const { data: idleNotes = [], mutate: mutateNotes } = useSWR<IdleNoteView[]>(
    `/api/idle-notes?from=${today}&to=${today}`,
    fetcher,
    LIVE,
  );
  const [idleFor, setIdleFor] = useState<DriverDTO | null>(null);
  const byDriver = new Map(shifts.map((s) => [s.driverId, s]));
  // Постоянно показываем штатных на окладе (работают каждый день); подменного/внешнего — только в день,
  // когда у него есть смена (решение Артёма 24.06). Так ряд не засоряется «Смена не открыта» у тех,
  // кто сегодня и не должен работать.
  const rows = drivers.filter((d) => d.onPayroll || byDriver.has(d.id));
  return (
    <section data-testid="shift-workload" className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Смены водителей</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((d) => (
          <ShiftWorkloadRow
            key={d.id}
            name={d.name}
            shift={byDriver.get(d.id) ?? null}
            now={now}
            idleNotedMinutes={idleNotes.filter((n) => n.driverId === d.id).reduce((s, n) => s + n.minutes, 0)}
            onIdle={() => setIdleFor(d)}
            onChange={onChange}
          />
        ))}
      </div>
      {idleFor ? (
        <IdleNotesModal
          driver={idleFor}
          today={today}
          notes={idleNotes.filter((n) => n.driverId === idleFor.id)}
          onClose={() => setIdleFor(null)}
          onChanged={() => void mutateNotes()}
        />
      ) : null}
    </section>
  );
}

function ShiftWorkloadRow({
  name,
  shift,
  now,
  idleNotedMinutes,
  onIdle,
  onChange,
}: {
  name: string;
  shift: ShiftDTO | null;
  now: number;
  idleNotedMinutes: number;
  onIdle: () => void;
  onChange: () => Promise<unknown>;
}) {
  const chip = shiftChip(shift);
  const [reopening, setReopening] = useState(false);
  async function reopen() {
    if (!shift) return;
    setReopening(true);
    try {
      await apiSend(`/api/shifts/${shift.id}`, "PATCH", { op: "reopen" });
      await onChange();
    } finally {
      setReopening(false);
    }
  }
  // Кнопка «Простой» + метка суммы за день (02.07) — и в строке без смены (пометка возможна всегда).
  const idleControls = (
    <>
      {idleNotedMinutes > 0 ? (
        <button
          type="button"
          onClick={onIdle}
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
          title="Пометки о простое за сегодня"
        >
          Пометка: {fmtDur(idleNotedMinutes)}
        </button>
      ) : null}
      <Button variant="ghost" className="h-7 px-2 text-xs text-slate-600" onClick={onIdle}>
        Простой
      </Button>
    </>
  );
  if (!shift) {
    return (
      <div className="rounded-lg border border-slate-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-800">{name}</span>
          <span className="flex shrink-0 items-center gap-2">
            {idleControls}
            <span className={chip.cls}>{chip.label}</span>
          </span>
        </div>
        <div className="mt-2 h-2.5 rounded bg-slate-100" />
      </div>
    );
  }
  const opened = new Date(shift.openedAt).getTime();
  const end = shift.closedAt ? new Date(shift.closedAt).getTime() : now;
  const spanMin = Math.max(0, Math.round((end - opened) / 60000));
  const worked = Math.min(spanMin, Math.max(0, shift.workedMinutes ?? 0));
  const idle = Math.max(0, spanMin - worked);
  const workedPct = spanMin > 0 ? (worked / spanMin) * 100 : 0;
  const idlePct = spanMin > 0 ? (idle / spanMin) * 100 : 0;
  return (
    <div className="rounded-lg border border-slate-100 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-800">{name}</span>
        <span className="flex shrink-0 items-center gap-2">
          {idleControls}
          {shift.status === "CLOSED" ? (
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs text-indigo-700"
              onClick={() => void reopen()}
              disabled={reopening}
            >
              Переоткрыть
            </Button>
          ) : null}
          <span className={chip.cls}>{chip.label}</span>
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Открыта в {shiftHHMM(shift.openedAt)}
        {shift.closedAt ? ` · закрыта в ${shiftHHMM(shift.closedAt)}` : ""}
        {shift.openedAtAdjustNote ? " · время скорректировано" : ""}
      </div>
      <div className="mt-1.5 flex h-2.5 overflow-hidden rounded bg-slate-100">
        <div className="bg-green-500" style={{ width: `${workedPct}%` }} />
        <div className="bg-slate-300" style={{ width: `${idlePct}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-green-500 align-middle" />В работе {fmtDur(worked)}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-300 align-middle" />Простой {fmtDur(idle)}
        </span>
      </div>
    </div>
  );
}

/**
 * Модалка пометок о простое (02.07): внести новую (дата/минуты/причина) + разобрать существующие
 * за сегодня (удалить / создать штраф). Водитель пометку не видит; штраф (если создать) появится
 * у него в «Мой расчёт» с автотекстом без комментария Милены.
 */
function IdleNotesModal({
  driver,
  today,
  notes,
  onClose,
  onChanged,
}: {
  driver: DriverDTO;
  today: string;
  notes: IdleNoteView[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [fineForId, setFineForId] = useState<string | null>(null);
  const [fineAmount, setFineAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Простой — ${driver.name}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-neutral-500">
          Водитель пометку не видит. Штраф (если создать) появится в его расчёте.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Дата</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-lg border border-neutral-300 px-2 text-sm outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Минуты</span>
            <input
              type="number"
              min={1}
              max={720}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="90"
              data-testid="idle-minutes"
              className="h-9 w-24 rounded-lg border border-neutral-300 px-2 text-sm outline-none"
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-xs text-neutral-500">Причина (видит только офис)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Напр.: выехал в 9:00, на точке в 10:30"
              data-testid="idle-note"
              className="h-9 rounded-lg border border-neutral-300 px-2 text-sm outline-none"
            />
          </label>
          <Button
            className="h-9"
            disabled={busy || !minutes.trim()}
            data-testid="idle-save"
            onClick={() =>
              void run(async () => {
                await apiSend("/api/idle-notes", "POST", {
                  driverId: driver.id,
                  date,
                  minutes: Number.parseInt(minutes, 10),
                  note: note.trim() || undefined,
                });
                setMinutes("");
                setNote("");
              })
            }
          >
            Внести
          </Button>
        </div>

        {notes.length > 0 ? (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium text-neutral-800">{fmtDur(n.minutes)}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-500">{n.note ?? "без причины"}</span>
                {n.kpiMarkId ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    Штраф создан
                  </span>
                ) : fineForId === n.id ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={fineAmount}
                      onChange={(e) => setFineAmount(e.target.value)}
                      placeholder="₽"
                      data-testid="idle-fine-amount"
                      className="h-8 w-20 rounded-lg border border-neutral-300 px-2 text-sm outline-none"
                      autoFocus
                    />
                    <Button
                      variant="secondary"
                      className="h-8 px-2 text-xs"
                      disabled={busy || !fineAmount.trim()}
                      data-testid="idle-fine-confirm"
                      onClick={() =>
                        void run(async () => {
                          await apiSend(`/api/idle-notes/${n.id}/fine`, "POST", {
                            amount: Number.parseInt(fineAmount, 10),
                          });
                          setFineForId(null);
                          setFineAmount("");
                        })
                      }
                    >
                      ОК
                    </Button>
                  </span>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-xs text-red-700"
                      disabled={busy}
                      onClick={() => setFineForId(n.id)}
                    >
                      Оштрафовать…
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-xs text-neutral-500"
                      disabled={busy}
                      onClick={() => void run(() => apiSend(`/api/idle-notes/${n.id}`, "DELETE"))}
                    >
                      Удалить
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-neutral-400">За сегодня пометок нет.</p>
        )}

        {error ? <p className="text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </Modal>
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
        <StatusBadge status={task.status} />
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
  const router = useRouter();
  // Провал в заявку — кликом по любой части плашки (решение Артёма 02.07.2026). Вложенный select
  // исполнителя гасит всплытие (stopPropagation ниже), поэтому общий клик его не перехватывает.
  const openTask = () => router.push(`/tasks/${task.id}`);
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
      className="relative cursor-pointer border-b border-slate-200 bg-white py-1.5 pl-3 pr-2 last:border-b-0 hover:bg-slate-50 active:cursor-grabbing"
    >
      <span className={`absolute left-0 top-0 h-full w-[3px] ${STATUS_BAR[task.status]}`} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-900">
          <TypeIcon name={task.type.icon} className="h-4 w-4 shrink-0 text-slate-500" />№{task.number}
          {task.priority ? <span className="text-red-500">●</span> : null}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* В пуле «Ближайшие 3 дня» показываем день — задачи разных дат вперемешку. */}
          {showDate && task.scheduledDate ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-600">
              {formatDateShort(task.scheduledDate)}
            </span>
          ) : null}
          <StatusBadge status={task.status} />
        </div>
      </div>
      <span className="mt-0.5 block truncate text-sm text-slate-800">{task.title}</span>
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
