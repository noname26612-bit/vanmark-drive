"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/attachments/:id с проверкой
   прав по сессионной куке; next/image ходил бы через свой прокси без куки и получил бы 404. */

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Phone, Navigation, Camera, X } from "lucide-react";
import { fetcher, apiSend, apiUpload } from "@/lib/fetcher";
import { compressImage } from "@/lib/image-compress";
import type { DriverDTO, TaskDetailDTO, TaskTypeDTO } from "@/lib/task-dto";
import type { TaskStatus } from "@/generated/prisma/enums";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  PASS_BADGE,
  PASS_LABEL,
  PAYMENT_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/lib/task-ui";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { CreateTaskModal } from "../../_components/create-task-modal";

const NEXT_FORWARD: Partial<Record<TaskStatus, { to: TaskStatus; label: string }>> = {
  ASSIGNED: { to: "ACCEPTED", label: "Принять" },
  ACCEPTED: { to: "EN_ROUTE", label: "В путь" },
  EN_ROUTE: { to: "ON_SITE", label: "На месте" },
  ON_SITE: { to: "DONE", label: "Выполнено" },
};

const KIND_LABEL: Record<string, string> = {
  created: "Создана",
  status_change: "Статус",
  assign: "Назначение",
  edit: "Изменение",
  reschedule: "Перенос",
  comment: "Комментарий",
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

  const forward = NEXT_FORWARD[task.status];
  const isTerminal = task.status === "DONE" || task.status === "CANCELLED";

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
        <Badge className={STATUS_BADGE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
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
          </Row>
        ) : null}
        <Row label="Пропуск">
          <Badge className={PASS_BADGE[task.passStatus]}>{PASS_LABEL[task.passStatus]}</Badge>
        </Row>
        {task.description ? <Row label="Описание">{task.description}</Row> : null}
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
          <Button variant="secondary" disabled={busy} onClick={() => setAction("hold")}>
            Ждёт
          </Button>
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

      {/* Фото — отчётные (от исполнителя) и приложенные при постановке (от диспетчера) */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Фото</h2>
        <div className="flex flex-wrap gap-2">
          {task.attachments.map((a) => (
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
            <Input type="date" autoFocus value={newDate} onChange={(e) => setNewDate(e.target.value)} />
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
