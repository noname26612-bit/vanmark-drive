"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/attachments/:id с проверкой
   прав по сессионной куке; next/image ходил бы через свой прокси без куки и получил бы 404. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Navigation, Camera, Copy, X, FileText, Banknote, Archive } from "lucide-react";
import { PhoneLinks } from "@/components/phone-call";
import { fetcher, apiSend, apiUpload } from "@/lib/fetcher";
import { compressImage } from "@/lib/image-compress";
import { actState } from "@/domain/act";
import { MANUAL_STATUSES } from "@/domain/task-status";
import { formatMinutes } from "@/domain/capacity";
import { PRICING_ENABLED } from "@/lib/features";
import { isStaffTask } from "@/lib/task-dto";
import { taskNumberLabel } from "@/lib/task-number";
import type { DriverDTO, TaskDetailDTO, TaskMachineDTO, TaskTypeDTO } from "@/lib/task-dto";
import type { TaskStatus } from "@/generated/prisma/enums";
import { TASK_MACHINE_DIRECTION_LABEL } from "@/domain/task-machine-flow";
import { MACHINE_STATUS_LABEL, formatMachineNumber } from "@/lib/machine-ui";
import {
  STATUS_LABEL,
  STATUS_BAR,
  PASS_BADGE,
  PASS_LABEL,
  PAYMENT_LABEL,
  actBadge,
  formatDate,
  formatDateTime,
  formatMoney,
  todayISO,
} from "@/lib/task-ui";
import { StatusBadge } from "@/components/status-badge";
import { WorksheetPricingSection } from "../../_components/worksheet-pricing-section";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { CreateTaskModal } from "../../_components/create-task-modal";
import { StaffTaskModal } from "../../_components/staff-task-modal";
import { useTaskDrafts } from "../../_components/task-drafts";
import { copyHint, copyTitle, formForCopy, type FormState } from "@/lib/task-draft";

// Диспетчер может вести статусы за исполнителя (в т.ч. внешнего перевозчика). Цепочка схлопнута (этап A):
// «В работу» (взять) → «Завершить»; из паузы — «Вернуть в работу».
const NEXT_FORWARD: Partial<Record<TaskStatus, { to: TaskStatus; label: string }>> = {
  ASSIGNED: { to: "IN_PROGRESS", label: "В работу" },
  IN_PROGRESS: { to: "DONE", label: "Завершить" },
  ON_HOLD: { to: "IN_PROGRESS", label: "Вернуть в работу" },
};

const KIND_LABEL: Record<string, string> = {
  created: "Создана",
  status_change: "Статус",
  assign: "Назначение",
  edit: "Изменение",
  reschedule: "Перенос",
  auto_date: "Дата",
  comment: "Комментарий",
  payment_received: "Оплата",
  payment_unpaid: "Не оплачено",
  act_missing_reason: "Акт не приложен",
  worksheet_submitted: "Ведомость",
  worksheet_priced: "Расценка",
  worksheet_repriced: "Цена исправлена",
  worksheet_signed: "Акт",
  worksheet_unsigned: "Акт",
  // Станки заявки (21.08.2026)
  machine_link: "Станок",
  machine_unlink: "Станок снят",
  machine_auto: "Автоматика по станку",
};

/**
 * Что сделала автоматика с этим станком. Три состояния, и различать их важно: «сработала»,
 * «не сработала — смотри историю» и нейтральное «—» для связи, добавленной уже после завершения
 * (её автоматика не запускает осознанно, и рисовать это ошибкой было бы враньём).
 */
function machineAutoLabel(m: TaskMachineDTO, isTerminal: boolean): string {
  if (m.appliedAt) {
    return m.appliedStatus
      ? `автоматика: ${MACHINE_STATUS_LABEL[m.appliedStatus]}`
      : "автоматика: отработала";
  }
  return isTerminal ? "автоматика: не сработала (см. историю)" : "автоматика: —";
}

// Цвет маркера события в ленте истории (дизайн 24.07.2026, вариант B): по целевому статусу перехода,
// прочие события (создание, назначение, перенос, комментарий) — нейтральный графит.
const EVENT_DOT: Partial<Record<TaskStatus, string>> = {
  DONE: "bg-green-600",
  IN_PROGRESS: "bg-blue-600",
  ON_HOLD: "bg-amber-500",
  CANCELLED: "bg-red-600",
};
function eventDot(toStatus: TaskStatus | null): string {
  return (toStatus && EVENT_DOT[toStatus]) || "bg-slate-300";
}

type ActionKind = "hold" | "cancel" | "reschedule" | "status" | null;

export function TaskDetailClient({
  taskId,
  drivers,
  types,
}: {
  taskId: string;
  drivers: DriverDTO[];
  types: TaskTypeDTO[];
}) {
  const key = `/api/tasks/${taskId}`;
  const { data: task, error, isLoading, mutate } = useSWR<TaskDetailDTO>(key, fetcher);
  // Исполнители задачи сотрудникам — те, кому открыт этот доступ (это может быть и не водитель).
  // Ключ null, пока карточка не загружена или она из контура доставок, — запрос не уходит.
  const { data: staffPerformers = [] } = useSWR<{ id: string; name: string }[]>(
    task && isStaffTask(task) ? "/api/staff-performers" : null,
    fetcher,
  );

  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState("");
  const [statusTarget, setStatusTarget] = useState<TaskStatus | "">(""); // цель «Изменить статус» (п.4)
  const [newDate, setNewDate] = useState("");
  const [comment, setComment] = useState("");
  /**
   * Режим формы заявки над карточкой (22.08.2026): правка, копия или восстановленный черновик.
   * Одно поле вместо трёх флагов — и `key` модалки, который от него зависит, заодно чинит старую
   * болячку: форма правки без ключа инициализировалась один раз и после mutate() показывала
   * устаревшие поля.
   */
  const [formMode, setFormMode] = useState<"edit" | "copy" | "draft" | null>(null);
  const [copyState, setCopyState] = useState<{ form: FormState; hint: string; label: string } | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ id: string; form: FormState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null); // input для акта (этап 14): фото или PDF
  const [repriceOpen, setRepriceOpen] = useState(false); // правка цены после подписания акта (B2)
  const [estimateInput, setEstimateInput] = useState(""); // ручная оценка времени (Фаза 2, §14)
  const [archiveOpen, setArchiveOpen] = useState(false); // переспрос перед архивацией (11.08)
  const [archiveReason, setArchiveReason] = useState("");

  // Черновики свёрнутых заявок: общий стек с доской и «Всеми задачами» (провайдер в лейауте).
  // Копия, закрытая мимо, сворачивается сюда же — а чип должен открывать её и на карточке.
  const router = useRouter();
  const drafts = useTaskDrafts();
  const registerOpenHandler = drafts.registerOpenHandler;
  useEffect(
    () =>
      registerOpenHandler((d) => {
        setEditingDraft({ id: d.id, form: d.form });
        setCopyState(null);
        setFormMode("draft");
      }),
    [registerOpenHandler],
  );

  if (isLoading) return <p className="p-6 text-sm text-neutral-400">Загрузка…</p>;
  if (error || !task)
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">Задача не найдена.</p>
        <Link href="/board" className="text-sm text-neutral-600 underline">
          ← К доске
        </Link>
      </div>
    );

  // «Копировать» (22.08.2026): та же работа в другой день — форма создания, предзаполненная из этой
  // заявки. Ничего не отправляется до кнопки «Создать»: копия — обычная новая заявка, номер и
  // журнал ей выдаёт сервер. У задачи цеха своя форма (ни типа, ни адреса у неё нет).
  function openCopy() {
    if (!task) return;
    if (isStaffTask(task)) {
      setCopyState(null);
      setEditingDraft(null);
      setFormMode("copy");
      return;
    }
    const { form, replacedTypeName } = formForCopy(task, { types, today: todayISO() });
    setCopyState({ form, label: copyTitle(task), hint: copyHint(task, replacedTypeName) });
    setEditingDraft(null);
    setFormMode("copy");
  }

  function closeForm() {
    setFormMode(null);
    setCopyState(null);
    setEditingDraft(null);
  }

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      await mutate();
      setAction(null);
      setReason("");
      setNewDate("");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function uploadPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    void run(async () => {
      for (const file of Array.from(files)) {
        const blob = await compressImage(file);
        const form = new FormData();
        form.append("file", blob, "photo.jpg");
        await apiUpload(`${key}/attachments`, form);
      }
    });
  }
  // Акт (этап 14): диспетчер тоже может приложить подписанный бланк (например, акт прислали в офис).
  // Фото сжимаем, PDF — как есть; kind=DOCUMENT.
  function uploadDoc(files: FileList | null) {
    if (!files || files.length === 0) return;
    void run(async () => {
      for (const file of Array.from(files)) {
        const isPdf = file.type === "application/pdf";
        const blob = isPdf ? file : await compressImage(file);
        const form = new FormData();
        form.append("file", blob, isPdf ? "akt.pdf" : "akt.jpg");
        form.append("kind", "DOCUMENT");
        await apiUpload(`${key}/attachments`, form);
      }
    });
  }
  const removePhoto = (id: string) => run(() => apiSend(`/api/attachments/${id}`, "DELETE"));

  const transition = (toStatus: TaskStatus, r?: string) =>
    run(() => apiSend(key + "/transition", "POST", { toStatus, reason: r }));
  // Свободная смена статуса (п.4, решение Артёма 24.07.2026): диспетчер/директор выставляет любой
  // актуальный статус, в т.ч. откат ошибочного «Завершено» (кейс №700). Причина обязательна при
  // откате из завершённой/отменённой и при отмене — совпадает с серверным reasonRequiredFor.
  const manualStatuses = [...MANUAL_STATUSES].filter((s) => s !== task.status);
  const statusReasonRequired =
    statusTarget !== "" &&
    (task.status === "DONE" || task.status === "CANCELLED" || statusTarget === "CANCELLED");
  const openStatusModal = () => {
    setStatusTarget("");
    setReason("");
    setActionError(null);
    setAction("status");
  };
  const applyStatusChange = () => {
    if (statusTarget === "") return;
    void transition(statusTarget, reason.trim() || undefined);
  };
  const assign = (assigneeId: string) =>
    run(() => apiSend(key, "PATCH", { op: "assign", assigneeId: assigneeId || null }));
  // Напарник (20.07): правка пары идёт через op:edit (единая точка записи updateTaskFields).
  const setCoDriver = (coDriverId: string) =>
    run(() => apiSend(key, "PATCH", { op: "edit", coDriverId: coDriverId || null }));
  // Плашка «Нужен акт» (решение Артёма 02.07.2026): тумблер прямо в карточке, доступен и для завершённых.
  // Один PATCH меняет требование у всех и пересчитывает KPI открытого месяца (сервер: syncUnsignedDocMark).
  const toggleAct = (next: boolean) =>
    run(() =>
      apiSend(key, "PATCH", {
        op: "edit",
        requiresAct: next,
        actWaivedNote: next ? null : (task?.actWaivedNote ?? null),
      }),
    );
  const saveActWaivedNote = (note: string) =>
    run(() =>
      apiSend(key, "PATCH", { op: "edit", requiresAct: false, actWaivedNote: note.trim() || null }),
    );
  const reschedule = () =>
    run(() => apiSend(key, "PATCH", { op: "reschedule", scheduledDate: newDate, comment }));
  const sendComment = () =>
    run(async () => {
      await apiSend(key + "/comments", "POST", { text: comment });
      setComment("");
    });
  // Оценка времени (Фаза 2, §14): задать вручную (number) или вернуть к авто-расчёту (null).
  const saveEstimate = () => {
    const n = Number.parseInt(estimateInput, 10);
    if (!Number.isFinite(n) || n < 0) {
      setActionError("Некорректная оценка времени");
      return;
    }
    void run(async () => {
      await apiSend(key, "PATCH", { estimatedMinutes: n });
      setEstimateInput("");
    });
  };
  const recomputeEstimate = () =>
    run(async () => {
      await apiSend(key, "PATCH", { estimatedMinutes: null });
      setEstimateInput("");
    });
  const forward = NEXT_FORWARD[task.status];
  const isTerminal = task.status === "DONE" || task.status === "CANCELLED";
  // Задача сотрудникам (15.08.2026): ни адреса, ни денег, ни пропуска, ни оценки времени —
  // соответствующие строки карточки просто не показываем, иначе они стоят пустыми.
  const staff = isStaffTask(task);
  const assignableList = staff
    ? staffPerformers
    : drivers.map((d) => ({ id: d.id, name: d.name }));

  // Оценка устарела: авто-снимок меньше текущей нормы типа — значит норму подняли уже после расчёта
  // (11.08.2026: доставкам добавили 30 мин на выгрузку). Разбивку в этом случае не показываем.
  const estimateStale =
    !task.estimateIsManual &&
    task.estimatedMinutes != null &&
    task.estimatedMinutes < task.type.onSiteMinutes;
  // Расценка ведомостей скрыта под флагом (06.07): весь блок расценки/итога по услугам не показываем.
  // Вернуть — включить PRICING_ENABLED в src/lib/features.ts. Акт (ниже) от расценки не зависит.
  const pricingVisible =
    PRICING_ENABLED &&
    task.type.requiresPricing &&
    task.workItems.length > 0 &&
    (task.worksheetStatus === "PRICING" || task.worksheetStatus === "PRICED");
  // Исправление цены после подписания акта (B2): возможно для SIGNED-ведомости, открывается по кнопке
  // в итоговом блоке. Тот же редактируемый блок, что и расценка, но с обязательным полем причины.
  const canReprice =
    PRICING_ENABLED &&
    task.type.requiresPricing &&
    task.workItems.length > 0 &&
    task.worksheetStatus === "SIGNED";
  const pricingEditable = pricingVisible || (canReprice && repriceOpen);
  // Итог по услугам из закреплённых цен (№7): остаётся виден после расценки/подписания и в завершённой
  // заявке, когда редактируемый блок расценки уже скрыт. Сумма — из сохранённых WorkItem.price.
  const finalServicesTotal = task.workItems.reduce((s, w) => s + (w.price ?? 0) * w.quantity, 0);
  const showFinalServices =
    PRICING_ENABLED &&
    task.type.requiresPricing &&
    task.workItems.length > 0 &&
    !pricingEditable &&
    (task.worksheetStatus === "SIGNED" || (isTerminal && task.workItems.some((w) => w.price != null)));

  // Акт (этап 14, PRD §13): документы (DOCUMENT) отделены от фото — PDF открывается ссылкой, не <img>.
  const photos = task.attachments.filter((a) => a.kind === "PHOTO");
  const docs = task.attachments.filter((a) => a.kind === "DOCUMENT");
  const act = actBadge(
    actState({
      requiresSignedDoc: task.requiresSignedDoc,
      actWaivedNote: task.actWaivedNote,
      hasSignedDoc: docs.length > 0,
    }),
    task.status === "DONE",
  );
  const showActSection = task.requiresSignedDoc || docs.length > 0;
  // Плашку-тумблер показываем, если акт для задачи вообще релевантен (тип с актом, требование стоит,
  // причина уже вписана или документ приложен). Для «неактовых» типов (доставки) не шумим.
  const showActToggle =
    task.type.requiresSignedDoc || task.requiresSignedDoc || !!task.actWaivedNote || docs.length > 0;

  return (
    <div className="mx-auto max-w-3xl p-4">
      <Link href="/board" className="text-sm text-neutral-500 hover:underline">
        ← К доске
      </Link>

      {/* Шапка-герой (дизайн 24.07.2026, вариант B): полоса статуса слева, крупный заголовок,
          тип/организация/адрес подзаголовком, статус-бейдж справа. */}
      <div className="relative mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white p-4 pl-5">
        <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_BAR[task.status]}`} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
              <TypeIcon name={task.type.icon} className="h-4 w-4" />
              {taskNumberLabel(task)} · {task.type.name}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-neutral-900">{task.title}</h1>
            <p className="mt-1 truncate text-sm text-neutral-500">
              {task.orgName ? `${task.orgName} · ` : ""}
              {staff ? "Задача сотруднику" : task.address}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge status={task.status} />
            {task.priority ? <Badge className="bg-red-100 text-red-700">Срочно</Badge> : null}
          </div>
        </div>
      </div>

      {/* Поля */}
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        {staff ? null : (
          <Row label="Адрес">
            {task.address}
            {task.addressLink ? (
              <a
                href={task.addressLink}
                target="_blank"
                rel="noopener"
                className="ml-2 inline-flex items-center gap-1 text-blue-600"
              >
                <Navigation className="h-3.5 w-3.5" /> Навигатор
              </a>
            ) : null}
          </Row>
        )}
        {task.orgName ? <Row label="Организация">{task.orgName}</Row> : null}
        {task.contactName || task.contactPhone ? (
          <Row label="Контакт">
            {task.contactName ?? ""} <PhoneLinks phone={task.contactPhone} />
          </Row>
        ) : null}
        {task.equipment ? <Row label="Оборудование">{task.equipment}</Row> : null}
        {/* Станки из картотеки (21.08.2026, PRD §16.1). Чип — ссылка в свой раздел; после
            завершения рядом видно, что сделала автоматика. */}
        {(task.machines ?? []).length > 0 ? (
          <div className="sm:col-span-2">
            <Row label="Станки">
              <span className="flex flex-wrap items-center gap-1.5" data-testid="task-machines">
                {(task.machines ?? []).map((m) => (
                  <Link
                    key={m.machineId}
                    href={`${m.machine.family === "SEAMER" ? "/seamers" : "/machines"}/${m.machineId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2 py-1 text-sm hover:border-neutral-400"
                  >
                    <span className="font-medium text-neutral-900">
                      {formatMachineNumber(m.machine) ?? m.machine.model}
                    </span>
                    <span className="text-neutral-600">{m.machine.model}</span>
                    <span className="text-xs text-neutral-500">
                      · {TASK_MACHINE_DIRECTION_LABEL[m.direction].toLowerCase()}
                    </span>
                    <span className="text-xs text-neutral-500">· {machineAutoLabel(m, isTerminal)}</span>
                  </Link>
                ))}
              </span>
            </Row>
          </div>
        ) : null}
        {task.invoiceNumber ? <Row label="Счёт">{task.invoiceNumber}</Row> : null}
        <Row label="Дата">{formatDate(task.scheduledDate)}</Row>
        {task.timeFrom || task.timeTo || task.timeNote ? (
          <Row label="Время">
            {task.timeFrom || task.timeTo ? `${task.timeFrom ?? ""}–${task.timeTo ?? ""} ` : ""}
            {task.timeNote ?? ""}
          </Row>
        ) : null}
        <Row label="Исполнитель">{task.assignee?.name ?? "Не назначено"}</Row>
        {task.coDriver ? <Row label="Напарник">{task.coDriver.name}</Row> : null}
        {/* Кто поставил заявку (11.08.2026): раньше это было видно только в истории внизу. */}
        <Row label="Заявку создал">{task.createdBy.name}</Row>
        {task.paymentType === "ON_SITE" && !isTerminal ? (
          /* Деньги на точке, вопрос открыт (17.07): янтарная плашка на всю ширину — видна сразу,
             как у водителя. После завершения гаснет в обычную строку с итогом «Оплачено/Не оплачено». */
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 sm:col-span-2">
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-amber-900">
              <Banknote className="h-4 w-4 shrink-0" /> Взять деньги на точке
              {task.paymentAmount ? (
                <span className="font-semibold">· {formatMoney(task.paymentAmount)}</span>
              ) : (
                <span className="font-normal text-amber-800">· сумма не указана</span>
              )}
            </p>
            {task.paymentNote ? <p className="mt-0.5 text-sm text-amber-800">{task.paymentNote}</p> : null}
          </div>
        ) : task.paymentType !== "NONE" ? (
          <Row label="Оплата">
            {PAYMENT_LABEL[task.paymentType]}
            {task.paymentAmount ? ` · ${formatMoney(task.paymentAmount)}` : ""}
            {task.paymentNote ? ` · ${task.paymentNote}` : ""}
            {/* Факт оплаты при завершении «на месте» (№8): заметная плашка, инфа не теряется. */}
            {task.paymentReceived === false ? (
              <span className="ml-2 inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                Не оплачено{task.paymentMissedReason ? `: ${task.paymentMissedReason}` : ""}
              </span>
            ) : task.paymentReceived === true ? (
              <span className="ml-2 inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Оплачено
              </span>
            ) : null}
          </Row>
        ) : null}
        {showFinalServices ? (
          <Row label="Услуги по ведомости">{finalServicesTotal.toLocaleString("ru")} ₽</Row>
        ) : null}
        {staff ? null : (
          <Row label="Пропуск">
            <Badge className={PASS_BADGE[task.passStatus]}>{PASS_LABEL[task.passStatus]}</Badge>
          </Row>
        )}
        {task.description ? <Row label="Описание">{task.description}</Row> : null}
        {task.holdReason ? <Row label="Причина паузы">{task.holdReason}</Row> : null}
        {task.cancelReason ? <Row label="Причина отмены">{task.cancelReason}</Row> : null}
      </div>

      {/* Плашка «Нужен акт» — быстрый тумблер прямо в заявке (решение Артёма 02.07.2026). Доступна и для
          завершённых. Меняет требование у всех (PATCH) и пересчитывает KPI открытого месяца. */}
      {showActToggle ? (
        <ActPanel
          key={`act-${task.requiresSignedDoc}-${task.actWaivedNote ?? ""}`}
          requiresSignedDoc={task.requiresSignedDoc}
          initialNote={task.actWaivedNote ?? ""}
          actLabel={act?.label ?? null}
          busy={busy}
          onToggle={toggleAct}
          onSaveNote={saveActWaivedNote}
        />
      ) : null}

      {/* Действия — панель (дизайн 24.07.2026, вариант B) */}
      {!isTerminal ? (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Действия</h2>
          <div className="flex flex-wrap items-center gap-2">
          {forward ? (
            <Button disabled={busy} onClick={() => transition(forward.to)}>
              {forward.label} →
            </Button>
          ) : null}
          {task.status === "ON_HOLD" ? (
            <Button variant="secondary" disabled={busy} onClick={() => transition("ASSIGNED")}>
              Снять с паузы
            </Button>
          ) : null}
          <Select
            data-testid="card-assignee"
            value={task.assigneeId ?? ""}
            disabled={busy}
            onChange={(e) => assign(e.target.value)}
            className="w-48"
          >
            <option value="">— не назначено —</option>
            {assignableList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {/* Напарник — и в доставке, и в цехе (16.08.2026). Список берём из того же контура, что и
              ответственного: водителя в заявку, исполнителя цеха — в задачу цеха. */}
          {task.assigneeId ? (
            <Select
              data-testid="card-co-driver"
              value={task.coDriverId ?? ""}
              disabled={busy}
              onChange={(e) => setCoDriver(e.target.value)}
              className="w-48"
              aria-label="Напарник"
            >
              <option value="">— без напарника —</option>
              {assignableList
                .filter((d) => d.id !== task.assigneeId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (напарник)
                  </option>
                ))}
            </Select>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => setAction("reschedule")}>
            Перенести
          </Button>
          {task.status === "IN_PROGRESS" ? (
            <Button variant="secondary" disabled={busy} onClick={() => setAction("hold")}>
              На паузу
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => setFormMode("edit")}>
            Редактировать
          </Button>
          <Button variant="secondary" disabled={busy} data-testid="task-copy" onClick={openCopy}>
            <Copy className="h-4 w-4" /> Копировать
          </Button>
          <Button variant="secondary" disabled={busy} onClick={openStatusModal}>
            Изменить статус
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setAction("cancel")}>
            Отменить
          </Button>
          </div>
        </section>
      ) : (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Действия</h2>
          <div className="flex flex-wrap items-center gap-2">
          {/* Редактирование закрытых заявок (решение Артёма 02.07.2026): диспетчер/руководитель/админ
              правят поля завершённой/отменённой заявки. Смена исполнителя и даты недоступна.
              «Изменить статус» (24.07.2026, кейс №700): откат ошибочного «Завершено»/«Отменено». */}
          <Button variant="secondary" disabled={busy} onClick={() => setFormMode("edit")}>
            Редактировать
          </Button>
          {/* Копия закрытой заявки — самый частый повод копировать: съездили, а через месяц туда же. */}
          <Button variant="secondary" disabled={busy} data-testid="task-copy" onClick={openCopy}>
            <Copy className="h-4 w-4" /> Копировать
          </Button>
          <Button variant="secondary" disabled={busy} onClick={openStatusModal}>
            Изменить статус
          </Button>
          <span className="self-center text-sm text-neutral-400">
            {task.status === "CANCELLED" ? "Заявка отменена" : "Заявка завершена"} — доступно редактирование.
          </span>
          </div>
        </section>
      )}
      {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}

      {/* Оценка времени (Фаза 2, PRD §14): авто-расчёт «норма типа + дорога»; диспетчер может
          задать вручную или вернуть к авто. Подсказка планирования — на загрузку влияет через календарь.
          У задач сотрудникам оценки нет: дороги в них не бывает, в календарь загрузки они не входят. */}
      {staff ? null : (
      <section className="mt-6" data-testid="estimate-section">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Оценка времени</h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-neutral-900" data-testid="estimate-total">
              {task.estimatedMinutes != null ? `≈ ${formatMinutes(task.estimatedMinutes)}` : "—"}
            </span>
            <Badge
              className={
                task.estimateIsManual ? "bg-violet-100 text-violet-700" : "bg-neutral-100 text-neutral-600"
              }
            >
              {task.estimateIsManual ? "вручную" : "авто"}
            </Badge>
          </div>
          {!task.estimateIsManual && task.estimatedMinutes != null ? (
            estimateStale ? (
              /* Оценка — снимок на момент расчёта, а норма типа с тех пор изменилась (11.08.2026:
                 доставкам добавили 30 минут на выгрузку). Разбивку «работа + дорога» в этом случае
                 не показываем: она считается вычитанием и дала бы отрицательную дорогу. */
              <p className="mt-1 text-xs text-amber-700" data-testid="estimate-stale">
                Оценка посчитана по прежней норме типа (сейчас работа{" "}
                {formatMinutes(task.type.onSiteMinutes)}) — нажмите «Пересчитать».
              </p>
            ) : (
              <p className="mt-1 text-xs text-neutral-500">
                работа {formatMinutes(task.type.onSiteMinutes)}
                {task.lat != null && task.lng != null
                  ? ` + дорога ${formatMinutes(Math.max(0, task.estimatedMinutes - task.type.onSiteMinutes))}`
                  : " · дорога не учтена (адрес не распознан геокодером)"}
              </p>
            )
          ) : null}
          {!isTerminal ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Задать вручную, мин">
                <Input
                  type="number"
                  min={0}
                  value={estimateInput}
                  disabled={busy}
                  onChange={(e) => setEstimateInput(e.target.value)}
                  placeholder={task.estimatedMinutes != null ? String(task.estimatedMinutes) : ""}
                  className="h-9 w-28"
                  data-testid="estimate-input"
                />
              </Field>
              <Button
                variant="secondary"
                disabled={busy || estimateInput.trim() === ""}
                onClick={saveEstimate}
                data-testid="estimate-save"
              >
                Сохранить
              </Button>
              {/* «Пересчитать авто» нужна и когда оценка устарела после смены нормы типа. */}
              {task.estimateIsManual || estimateStale ? (
                <Button variant="ghost" disabled={busy} onClick={recomputeEstimate} data-testid="estimate-recompute">
                  Пересчитать{task.estimateIsManual ? " авто" : ""}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
      )}

      {/* Фото — отчётные (от исполнителя) и приложенные при постановке (от диспетчера) */}
      {/* Расценка ведомости — диспетчер ставит цены по позициям (этап 13, PRD §13) */}
      {pricingEditable ? (
        <WorksheetPricingSection
          taskId={task.id}
          workItems={task.workItems}
          worksheetStatus={task.worksheetStatus}
          reprice={task.worksheetStatus === "SIGNED"}
          onSaved={() => {
            void mutate();
            setRepriceOpen(false);
          }}
          onCancel={() => setRepriceOpen(false)}
        />
      ) : null}

      {/* Итоговый расчёт по услугам (№7): нередактируемый — остаётся виден после подписания акта и в
          завершённой заявке (когда блок расценки уже скрыт). Источник — закреплённые цены позиций. */}
      {showFinalServices ? (
        <section className="mt-6" data-testid="final-services">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Итоговый расчёт по услугам</h2>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Работа</th>
                  <th className="px-3 py-2">Кол-во</th>
                  <th className="px-3 py-2">Цена, ₽</th>
                  <th className="px-3 py-2 text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {task.workItems.map((w) => (
                  <tr key={w.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2">{w.name}</td>
                    <td className="px-3 py-2">{w.quantity}</td>
                    <td className="px-3 py-2">{w.price != null ? w.price.toLocaleString("ru") : "—"}</td>
                    <td className="px-3 py-2 text-right">{((w.price ?? 0) * w.quantity).toLocaleString("ru")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-right text-base font-semibold text-neutral-900">
            Итого: {finalServicesTotal.toLocaleString("ru")} ₽
          </div>
          {/* Исправление цены после подписания акта (B2) — только с причиной, см. блок расценки. */}
          {canReprice ? (
            <div className="mt-2 text-right">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setRepriceOpen(true)}
                data-testid="reprice-open"
              >
                Исправить цену
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Акт (этап 14, PRD §13): подписанный бумажный бланк — фото или скан. Отдельно от фото-галереи,
          чтобы PDF открывался ссылкой, а не ломался как <img>; здесь же — признак комплектности. */}
      {showActSection ? (
        <section className="mt-6" data-testid="act-section">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-700">
            Акт
            {act ? <Badge className={act.className}>{act.label}</Badge> : null}
          </h2>
          {docs.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {docs.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <a
                    href={`/api/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 underline"
                  >
                    <FileText className="h-4 w-4" /> Акт{" "}
                    {a.mimeType === "application/pdf" ? "(PDF)" : "(фото)"}
                  </a>
                  {task.status !== "DONE" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removePhoto(a.id)}
                      aria-label="Удалить акт"
                      className="p-1 text-neutral-400 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">
              {task.requiresSignedDoc
                ? "Акт ещё не приложен. Обычно прикладывает водитель на объекте; можно приложить и здесь."
                : "Акт по этой заявке не требуется."}
            </p>
          )}
          {task.status !== "CANCELLED" ? (
            <Button variant="secondary" className="mt-2" disabled={busy} onClick={() => docRef.current?.click()}>
              <FileText className="h-4 w-4" /> Приложить акт
            </Button>
          ) : null}
          <input
            ref={docRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              uploadDoc(e.target.files);
              e.target.value = "";
            }}
          />
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Фото</h2>
        <div className="flex flex-wrap gap-2">
          {photos.map((a) => (
            <div key={a.id} className="relative">
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">
                <img
                  src={`/api/attachments/${a.id}`}
                  alt="фото"
                  className="h-24 w-24 rounded-lg object-cover"
                />
              </a>
              <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/50 py-0.5 text-center text-[10px] text-white">
                {a.createdById === task.assigneeId
                  ? "исполнитель"
                  : a.createdById === task.coDriverId
                    ? "напарник"
                    : "диспетчер"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => removePhoto(a.id)}
                aria-label="Удалить фото"
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-neutral-300 text-xs text-neutral-500 disabled:opacity-50"
          >
            <Camera className="h-6 w-6" /> Добавить
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            uploadPhotos(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      {/* История — лента с маркерами по типу события (дизайн 24.07.2026, вариант B) */}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-neutral-700">История</h2>
      <ol className="ml-1 space-y-2.5 border-l-2 border-neutral-200 pl-4">
        {task.events.map((ev) => (
          <li key={ev.id} className="relative text-sm">
            <span
              className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${eventDot(ev.toStatus)}`}
            />
            <span className="text-neutral-400">{formatDateTime(ev.at)}</span>{" "}
            <span className="font-medium text-neutral-700">{ev.actor.name}</span>{" "}
            <span className="text-neutral-500">· {KIND_LABEL[ev.kind] ?? ev.kind}</span>
            {ev.toStatus ? <span className="text-neutral-700"> → {STATUS_LABEL[ev.toStatus]}</span> : null}
            {ev.comment ? <span className="text-neutral-600"> · {ev.comment}</span> : null}
          </li>
        ))}
      </ol>

      {/* Комментарий */}
      <div className="mt-4 flex flex-col gap-2">
        <Textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Добавить комментарий…"
        />
        <Button variant="secondary" disabled={busy || !comment.trim()} onClick={sendComment} className="self-start">
          Отправить комментарий
        </Button>
      </div>

      {/* Архив (решение Артёма 11.08.2026) — в самом низу, отдельно от рабочих кнопок: это не шаг
          процесса, а способ убрать дубль или ошибочно заведённую заявку. Не удаление: заявка и её
          история остаются, номер сохраняется, вернуть можно во «Все задачи» → «Архив». */}
      <div className="mt-8 border-t border-neutral-200 pt-4">
        {task.archivedAt ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-neutral-600" data-testid="task-archived-note">
              <Archive className="mr-1 inline h-4 w-4 text-neutral-400" />
              Заявка в архиве · {formatDateTime(task.archivedAt)}
              {task.archivedByName ? ` · ${task.archivedByName}` : ""}
            </p>
            <Button
              variant="secondary"
              className="h-9 px-3 text-sm"
              disabled={busy}
              data-testid="task-unarchive"
              onClick={() => void run(() => apiSend(key, "PATCH", { op: "unarchive" }))}
            >
              Вернуть из архива
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              className="h-9 px-3 text-sm text-neutral-500 hover:text-red-700"
              disabled={busy}
              data-testid="task-archive"
              onClick={() => setArchiveOpen(true)}
            >
              <Archive className="mr-1.5 h-4 w-4" /> В архив
            </Button>
            <span className="text-xs text-neutral-400">
              Убрать дубль или ошибочную заявку из всех списков. Вернуть можно во «Все задачи» → «Архив».
            </span>
          </div>
        )}
      </div>

      {/* Переспрос перед архивацией: действие незаметное на экране (заявка просто исчезает), поэтому
          подтверждение обязательно. Причина по желанию — уходит в журнал. */}
      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={staff ? "Убрать задачу в архив?" : "Убрать заявку в архив?"}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600">
            {staff ? "Задача" : "Заявка"} {taskNumberLabel(task)} исчезнет{" "}
            {staff
              ? "из «Цеха», из списка исполнителя"
              : "из «Водителей», «Планирования», «Календаря», из списков водителя"}{" "}
            и из отчётов. История сохранится, номер останется за ней. Вернуть можно во «Все задачи» →
            «Архив».
          </p>
          <Field label="Причина (по желанию)">
            <Textarea
              autoFocus
              rows={2}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="Дубль заявки №…, завели по ошибке"
              data-testid="task-archive-reason"
            />
          </Field>
          {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
          <Button
            variant="danger"
            disabled={busy}
            data-testid="task-archive-confirm"
            className="self-start"
            onClick={() =>
              void run(async () => {
                await apiSend(key, "PATCH", { op: "archive", reason: archiveReason.trim() || null });
                setArchiveOpen(false);
                setArchiveReason("");
              })
            }
          >
            Убрать в архив
          </Button>
        </div>
      </Modal>

      {/* Модалка причины (Ждёт/Отмена) */}
      <Modal
        open={action === "hold" || action === "cancel"}
        onClose={() => setAction(null)}
        title={action === "cancel" ? "Отменить задачу" : "Поставить на паузу"}
      >
        <div className="flex flex-col gap-3">
          <Field
            label={action === "cancel" ? "Причина" : "Причина (по желанию)"}
            required={action === "cancel"}
          >
            <Textarea
              autoFocus
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action === "cancel" ? "Почему отменяем" : "Нет пропуска, ждём запчасти…"}
            />
          </Field>
          {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
          <Button
            variant={action === "cancel" ? "danger" : "primary"}
            disabled={busy || (action === "cancel" && !reason.trim())}
            onClick={() => transition(action === "cancel" ? "CANCELLED" : "ON_HOLD", reason)}
            className="self-start"
          >
            {action === "cancel" ? "Отменить задачу" : "На паузу"}
          </Button>
        </div>
      </Modal>

      {/* Модалка переноса */}
      <Modal open={action === "reschedule"} onClose={() => setAction(null)} title="Перенести задачу">
        <div className="flex flex-col gap-3">
          <Field label="Новая дата" required>
            <DateField testId="reschedule-date" autoFocus value={newDate} onChange={setNewDate} />
          </Field>
          <Field label="Комментарий">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="необязательно" />
          </Field>
          {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
          <Button disabled={busy || !newDate} onClick={reschedule} className="self-start">
            Перенести
          </Button>
        </div>
      </Modal>

      {/* Изменить статус вручную (п.4, кейс №700): диспетчер/директор выставляет любой актуальный
          статус, включая откат ошибочного «Завершено»/«Отменено». Причина обязательна при откате/отмене
          (сервер: reasonRequiredFor); «отпечатки» завершения снимает transitionTask. */}
      <Modal open={action === "status"} onClose={() => setAction(null)} title="Изменить статус">
        <div className="flex flex-col gap-3">
          <Field label="Новый статус" required>
            <Select
              data-testid="status-target"
              autoFocus
              value={statusTarget}
              onChange={(e) => setStatusTarget(e.target.value as TaskStatus)}
            >
              <option value="">— выберите статус —</option>
              {manualStatuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={statusReasonRequired ? "Причина" : "Причина (по желанию)"}
            required={statusReasonRequired}
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Напр.: водитель ошибочно завершил — по факту заявка отменилась"
            />
          </Field>
          {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
          <Button
            data-testid="status-apply"
            disabled={busy || statusTarget === "" || (statusReasonRequired && !reason.trim())}
            onClick={applyStatusChange}
            className="self-start"
          >
            Применить
          </Button>
        </div>
      </Modal>

      {/* Правка идёт формой своего контура (16.08.2026): у задачи цеха нет ни типа, ни адреса, ни
          денег — форма заявки предлагала бы заполнить то, чего у неё не существует.
          `key` по режиму: без него форма инициализируется один раз и во втором открытии (или после
          mutate) показывает поля прошлой. */}
      {staff ? (
        formMode === "edit" || formMode === "copy" ? (
          <StaffTaskModal
            key={formMode}
            performers={staffPerformers}
            today={todayISO()}
            editTask={formMode === "edit" ? task : null}
            copyFrom={formMode === "copy" ? task : null}
            onClose={closeForm}
            onSaved={(created) => {
              closeForm();
              if (created) router.push(`/tasks/${created.id}`);
              else void mutate();
            }}
          />
        ) : null
      ) : (
        <CreateTaskModal
          key={formMode === "draft" ? `draft-${editingDraft?.id ?? "new"}` : (formMode ?? "closed")}
          open={formMode !== null}
          onClose={closeForm}
          types={types}
          drivers={drivers}
          editTask={formMode === "edit" ? task : null}
          initialForm={formMode === "copy" ? (copyState?.form ?? null) : (editingDraft?.form ?? null)}
          copyOf={
            formMode === "copy" && copyState ? { label: copyState.label, hint: copyState.hint } : null
          }
          onCreated={(created) => {
            // Копия создана — открываем НОВУЮ заявку: там её и назначают водителю. Правка остаётся
            // на месте и просто перечитывает карточку.
            if (created) router.push(`/tasks/${created.id}`);
            else void mutate();
          }}
          onMinimize={(form) => drafts.upsertDraft(form, editingDraft?.id ?? null)}
          onDiscard={() => {
            if (editingDraft?.id) drafts.removeDraft(editingDraft.id);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="text-sm text-neutral-800">{children}</span>
    </div>
  );
}

// Плашка «Нужен акт» в карточке заявки (решение Артёма 02.07.2026). Отдельный компонент — чтобы черновик
// причины хранить локально без useEffect; key по requiresSignedDoc/actWaivedNote пересоздаёт её при
// серверном обновлении (после сохранения показывается актуальное). Менять требование могут диспетчер/
// руководитель/админ — карточка доступна только им (изоляция в API), в т.ч. для завершённых заявок.
function ActPanel({
  requiresSignedDoc,
  initialNote,
  actLabel,
  busy,
  onToggle,
  onSaveNote,
}: {
  requiresSignedDoc: boolean;
  initialNote: string;
  actLabel: string | null;
  busy: boolean;
  onToggle: (next: boolean) => void;
  onSaveNote: (note: string) => void;
}) {
  const [note, setNote] = useState(initialNote);
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" data-testid="act-toggle">
      <label className="flex items-center gap-3 text-base font-medium text-neutral-900">
        <input
          type="checkbox"
          data-testid="act-toggle-checkbox"
          checked={requiresSignedDoc}
          disabled={busy}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-5 w-5"
        />
        Нужен подписанный акт
      </label>
      {requiresSignedDoc ? (
        <p className="mt-2 text-sm text-neutral-500">
          {actLabel ? `Статус: ${actLabel}. ` : ""}Снимите галочку, если по этой заявке акт не нужен.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-sm text-neutral-500">Почему без акта (по желанию)</label>
            <Input
              data-testid="act-waived-note"
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              placeholder="напр. «подпишут по ЭДО»"
            />
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => onSaveNote(note)}>
            Сохранить
          </Button>
        </div>
      )}
    </div>
  );
}
