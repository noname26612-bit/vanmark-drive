"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/attachments/:id с проверкой
   прав по сессионной куке; next/image ходил бы через свой прокси без куки и получил бы 404. */

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Phone, Navigation, Camera, X, FileText } from "lucide-react";
import { fetcher, apiSend, apiUpload } from "@/lib/fetcher";
import { compressImage } from "@/lib/image-compress";
import { actState } from "@/domain/act";
import { formatMinutes } from "@/domain/capacity";
import type { DriverDTO, TaskDetailDTO, TaskTypeDTO } from "@/lib/task-dto";
import type { TaskStatus } from "@/generated/prisma/enums";
import {
  STATUS_LABEL,
  PASS_BADGE,
  PASS_LABEL,
  PAYMENT_LABEL,
  actBadge,
  formatDate,
  formatDateTime,
  formatMoney,
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
};

type ActionKind = "hold" | "cancel" | "reschedule" | null;

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

  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null); // input для акта (этап 14): фото или PDF
  const [repriceOpen, setRepriceOpen] = useState(false); // правка цены после подписания акта (B2)
  const [estimateInput, setEstimateInput] = useState(""); // ручная оценка времени (Фаза 2, §14)

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
  const assign = (assigneeId: string) =>
    run(() => apiSend(key, "PATCH", { op: "assign", assigneeId: assigneeId || null }));
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
  const pricingVisible =
    task.type.requiresPricing &&
    task.workItems.length > 0 &&
    (task.worksheetStatus === "PRICING" || task.worksheetStatus === "PRICED");
  // Исправление цены после подписания акта (B2): возможно для SIGNED-ведомости, открывается по кнопке
  // в итоговом блоке. Тот же редактируемый блок, что и расценка, но с обязательным полем причины.
  const canReprice =
    task.type.requiresPricing && task.workItems.length > 0 && task.worksheetStatus === "SIGNED";
  const pricingEditable = pricingVisible || (canReprice && repriceOpen);
  // Итог по услугам из закреплённых цен (№7): остаётся виден после расценки/подписания и в завершённой
  // заявке, когда редактируемый блок расценки уже скрыт. Сумма — из сохранённых WorkItem.price.
  const finalServicesTotal = task.workItems.reduce((s, w) => s + (w.price ?? 0) * w.quantity, 0);
  const showFinalServices =
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

  return (
    <div className="mx-auto max-w-3xl p-4">
      <Link href="/board" className="text-sm text-neutral-500 hover:underline">
        ← К доске
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <TypeIcon name={task.type.icon} className="h-6 w-6 text-neutral-500" />
        <h1 className="text-xl font-semibold text-neutral-900">
          №{task.number} · {task.title}
        </h1>
        <StatusBadge status={task.status} />
        {task.priority ? <Badge className="bg-red-100 text-red-700">Срочно</Badge> : null}
      </div>
      <p className="mt-1 text-sm text-neutral-500">{task.type.name}</p>

      {/* Поля */}
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <Row label="Адрес">
          {task.address}
          {task.addressLink ? (
            <a href={task.addressLink} target="_blank" rel="noopener" className="ml-2 inline-flex items-center gap-1 text-blue-600">
              <Navigation className="h-3.5 w-3.5" /> Навигатор
            </a>
          ) : null}
        </Row>
        {task.orgName ? <Row label="Организация">{task.orgName}</Row> : null}
        {task.contactName || task.contactPhone ? (
          <Row label="Контакт">
            {task.contactName ?? ""}{" "}
            {task.contactPhone ? (
              <a href={`tel:${task.contactPhone}`} className="inline-flex items-center gap-1 text-blue-600">
                <Phone className="h-3.5 w-3.5" /> {task.contactPhone}
              </a>
            ) : null}
          </Row>
        ) : null}
        {task.equipment ? <Row label="Оборудование">{task.equipment}</Row> : null}
        {task.invoiceNumber ? <Row label="Счёт">{task.invoiceNumber}</Row> : null}
        <Row label="Дата">{formatDate(task.scheduledDate)}</Row>
        {task.timeFrom || task.timeTo || task.timeNote ? (
          <Row label="Время">
            {task.timeFrom || task.timeTo ? `${task.timeFrom ?? ""}–${task.timeTo ?? ""} ` : ""}
            {task.timeNote ?? ""}
          </Row>
        ) : null}
        <Row label="Исполнитель">{task.assignee?.name ?? "Не назначено"}</Row>
        {task.paymentType !== "NONE" ? (
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
        <Row label="Пропуск">
          <Badge className={PASS_BADGE[task.passStatus]}>{PASS_LABEL[task.passStatus]}</Badge>
        </Row>
        {task.description ? <Row label="Описание">{task.description}</Row> : null}
        {act ? (
          <Row label="Акт">
            <span className="inline-flex items-center gap-1.5">
              <Badge className={act.className}>{act.label}</Badge>
              {task.actWaivedNote ? (
                <span className="text-neutral-500">· {task.actWaivedNote}</span>
              ) : null}
            </span>
          </Row>
        ) : null}
        {task.holdReason ? <Row label="Причина паузы">{task.holdReason}</Row> : null}
        {task.cancelReason ? <Row label="Причина отмены">{task.cancelReason}</Row> : null}
      </div>

      {/* Действия */}
      {!isTerminal ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={busy} onClick={() => setAction("reschedule")}>
            Перенести
          </Button>
          {task.status === "IN_PROGRESS" ? (
            <Button variant="secondary" disabled={busy} onClick={() => setAction("hold")}>
              На паузу
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => setEditOpen(true)}>
            Редактировать
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setAction("cancel")}>
            Отменить
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-neutral-400">Задача завершена — действий нет.</p>
      )}
      {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}

      {/* Оценка времени (Фаза 2, PRD §14): авто-расчёт «норма типа + дорога»; диспетчер может
          задать вручную или вернуть к авто. Подсказка планирования — на загрузку влияет через календарь. */}
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
            <p className="mt-1 text-xs text-neutral-500">
              работа {formatMinutes(task.type.onSiteMinutes)}
              {task.lat != null && task.lng != null
                ? ` + дорога ${formatMinutes(Math.max(0, task.estimatedMinutes - task.type.onSiteMinutes))}`
                : " · дорога не учтена (адрес не распознан геокодером)"}
            </p>
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
              {task.estimateIsManual ? (
                <Button variant="ghost" disabled={busy} onClick={recomputeEstimate} data-testid="estimate-recompute">
                  Пересчитать авто
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

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
                {a.createdById === task.assigneeId ? "исполнитель" : "диспетчер"}
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

      {/* История */}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-neutral-700">История</h2>
      <ol className="space-y-2 border-l-2 border-neutral-200 pl-4">
        {task.events.map((ev) => (
          <li key={ev.id} className="text-sm">
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

      {/* Модалка причины (Ждёт/Отмена) */}
      <Modal
        open={action === "hold" || action === "cancel"}
        onClose={() => setAction(null)}
        title={action === "cancel" ? "Отменить задачу" : "Поставить на паузу"}
      >
        <div className="flex flex-col gap-3">
          <Field label="Причина" required>
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
            disabled={busy || !reason.trim()}
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

      <CreateTaskModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        types={types}
        drivers={drivers}
        editTask={task}
        onCreated={() => void mutate()}
      />
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
