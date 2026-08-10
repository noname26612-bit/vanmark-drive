"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/machines/photos/:id по сессионной
   куке; next/image ходит через свой прокси без куки и получил бы 404. */

import { useRef, useState } from "react";
import useSWR from "swr";
import { Camera, Copy, Factory, MapPin, Stethoscope, Trash2 } from "lucide-react";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { BackLink } from "@/components/back-link";
import {
  EQUIPMENT_KINDS,
  EQUIPMENT_KIND_LABEL,
  MACHINE_CATEGORIES,
  isArchivedStatus,
  isOurCategory,
  reasonRequiredFor,
  statusesForCategory,
} from "@/domain/machine-status";
import { machineDueState } from "@/domain/machine-flags";
import {
  EVENT_LABEL,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
  dueBadgeClass,
  formatDay,
  formatMoment,
  machineTitle,
} from "@/lib/machine-ui";
import { copyText } from "@/lib/clipboard";
import type { MachineDetail, MachineEventView } from "@/lib/machine-dto";
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";
import { MachineCategoryBadge, MachineKindBadge, MachineStatusBadge } from "../_components/machine-badges";
import { ModelCombobox } from "../_components/model-combobox";
import { ShopTaskModal } from "./shop-task-modal";
import { uploadMachinePhotos } from "@/lib/machine-photo-upload";

export function MachineCardClient({ id, initial }: { id: string; initial: MachineDetail }) {
  const { data: machine = initial, mutate } = useSWR<MachineDetail>(
    `/api/machines/${id}`,
    fetcher,
    { fallbackData: initial, revalidateOnFocus: true },
  );
  // Справочники формы: сотрудники офиса для «Ответственного» и модели для подсказок комбобокса.
  const { data: meta } = useSWR<{ responsibles: { id: string; name: string }[]; models: string[] }>(
    "/api/machines/meta",
    fetcher,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [shopTaskOpen, setShopTaskOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pinnedEditing, setPinnedEditing] = useState(false);
  const [pinnedDraft, setPinnedDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await apiSend<MachineDetail>(`/api/machines/${id}`, "PATCH", body);
      await mutate(updated, { revalidate: false });
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Перевод в архив — с переспросом (решение совета): «Выдан»/«Продан»/«Аннулирован» убирают
  // станок из основного списка, и случайный тап по выпадашке не должен этого делать молча.
  async function changeStatus(next: MachineStatus) {
    if (next === machine.status) return;
    let reason: string | null = null;
    if (reasonRequiredFor(next)) {
      reason = window.prompt(
        "Аннулировать карточку? Укажите причину (например: «дубль станка №212»)",
      );
      if (!reason?.trim()) return; // отказались или не указали причину — не трогаем станок
    } else if (isArchivedStatus(next)) {
      const ok = window.confirm(
        `Перевести станок в состояние «${MACHINE_STATUS_LABEL[next]}»? Он уйдёт в архив (вернуть можно).`,
      );
      if (!ok) return;
    }
    await send({ op: "status", status: next, reason });
  }

  async function changeCategory(next: MachineCategory) {
    if (next === machine.category) return;
    await send({ op: "category", category: next });
  }

  async function addPhotos(list: FileList | null) {
    if (!list || list.length === 0 || uploading) return;
    const files = Array.from(list);
    setUploading({ done: 0, total: files.length });
    setError(null);
    const failed = await uploadMachinePhotos(machine.id, files, (p) =>
      setUploading({ done: p.done, total: p.total }),
    );
    setUploading(null);
    if (failed.length > 0) setError(`Не загрузилось фото: ${failed.length}. Попробуйте ещё раз.`);
    await mutate();
  }

  async function removePhoto(photoId: string) {
    if (!window.confirm("Удалить фото?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/machines/photos/${photoId}`, "DELETE");
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить фото");
    } finally {
      setBusy(false);
    }
  }

  async function sendComment() {
    const text = comment.trim();
    // busy проверяем и здесь: Enter в поле не смотрит на disabled кнопки, а журнал — только на запись,
    // задвоенный комментарий из него уже не убрать.
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiSend<MachineDetail>(`/api/machines/${id}/comments`, "POST", {
        comment: text,
      });
      setComment("");
      await mutate(updated, { revalidate: false });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось добавить комментарий");
    } finally {
      setBusy(false);
    }
  }

  const archived = isArchivedStatus(machine.status);
  // Комментарии живут отдельной лентой, технические события — в сворачиваемой «Истории».
  const comments = machine.events.filter((e) => e.kind === "comment");
  const history = machine.events.filter((e) => e.kind !== "comment");
  // События отсортированы свежие-сверху — первый shop_task и есть последнее задание в цех.
  const lastShopTask = machine.events.find((e) => e.kind === "shop_task") ?? null;
  const dueState = machineDueState(machine, new Date());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <BackLink href="/machines" className="self-start !text-base !py-2">
        Станки
      </BackLink>

      <header className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-neutral-900" data-testid="machine-title">
            {machineTitle(machine)}
          </h1>
          <MachineStatusBadge status={machine.status} size="md" />
          <MachineKindBadge kind={machine.kind} />
          <MachineCategoryBadge category={machine.category} />
          {machine.isUrgent ? (
            <span className="rounded border border-amber-500 px-2 py-0.5 text-xs font-medium text-amber-700">
              Срочный
            </span>
          ) : null}
        </div>
        <p className="text-base text-neutral-800">
          {machine.model}
          {machine.metalThickness ? (
            <span className="text-neutral-500"> · {machine.metalThickness}</span>
          ) : null}
        </p>
        {archived && machine.voidReason ? (
          <p className="text-sm text-red-700">Аннулирован: {machine.voidReason}</p>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {/* ── Состояние и категория ── */}
      <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Состояние">
            <Select
              value={machine.status}
              disabled={busy}
              onChange={(e) => changeStatus(e.target.value as MachineStatus)}
              data-testid="machine-status-select"
            >
              {statusesForCategory(machine.category).map((s) => (
                <option key={s} value={s}>
                  {MACHINE_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Категория">
            <Select
              value={machine.category}
              disabled={busy}
              onChange={(e) => changeCategory(e.target.value as MachineCategory)}
              data-testid="machine-category-select"
            >
              {MACHINE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MACHINE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Срок готовности/выдачи — оперативное поле, правится прямо здесь, без формы «Изменить».
            DateField коммитит по выбору/Enter/уходу из поля — лишних запросов не будет. */}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <div className="w-52 shrink-0">
            <Field label="Срок готовности / выдачи">
              <DateField
                value={machine.dueDate ?? ""}
                disabled={busy}
                onChange={(v) => {
                  if ((machine.dueDate ?? "") !== v) send({ op: "edit", dueDate: v });
                }}
                testId="machine-due-date"
              />
            </Field>
          </div>
          {machine.dueDate ? (
            <span
              className={cn("mb-2 rounded px-2 py-0.5 text-xs font-medium", dueBadgeClass(dueState))}
              data-testid="machine-due-state"
            >
              {dueState === "overdue"
                ? `Просрочен (${formatDay(machine.dueDate)})`
                : dueState === "soon"
                  ? `Горит: ${formatDay(machine.dueDate)}`
                  : `До ${formatDay(machine.dueDate)}`}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setShopTaskOpen(true)}
            data-testid="machine-shop-task"
          >
            <Factory className="h-4 w-4" />
            Задание в цех
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => send({ op: "diagnosed" })}
            data-testid="machine-diagnosed"
          >
            <Stethoscope className="h-4 w-4" />
            Диагностика проведена
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => send({ op: "verified" })}
            data-testid="machine-verified"
          >
            <MapPin className="h-4 w-4" />
            Подтверждён на месте
          </Button>
        </div>
        <p className="text-xs text-neutral-500">
          Диагностика:{" "}
          {machine.diagnosedAt ? (
            <span className="text-neutral-700">{formatMoment(machine.diagnosedAt)}</span>
          ) : (
            "не отмечена"
          )}{" "}
          · Сверка:{" "}
          {machine.lastVerifiedAt ? (
            <span className="text-neutral-700">{formatMoment(machine.lastVerifiedAt)}</span>
          ) : (
            "не отмечена"
          )}
        </p>

        {/* Пока станок в ремонте, последнее переданное задание видно без раскопок в истории. */}
        {machine.status === "IN_REPAIR" && lastShopTask?.comment ? (
          <LastShopTask event={lastShopTask} />
        ) : null}
      </section>

      {/* ── Фото ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700">Фото</h2>
          {/* Подпись «Добавить фото», а не просто «Добавить»: ниже есть кнопка добавления
              комментария, и две одинаковые подписи на одном экране путают. */}
          <Button
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy || uploading !== null}
            data-testid="machine-add-photo"
          >
            <Camera className="h-4 w-4" /> {uploading ? "Загружаю…" : "Добавить фото"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
            data-testid="machine-card-photo-input"
          />
        </div>
        {uploading ? (
          <p className="mb-2 text-xs text-neutral-500">
            Загружаю фото {uploading.done}/{uploading.total}…
          </p>
        ) : null}
        {machine.attachments.length === 0 ? (
          <p className="text-sm text-neutral-400">Фото пока нет.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {machine.attachments.map((a) => (
              <li key={a.id} className="relative">
                <button
                  type="button"
                  onClick={() => setLightbox(`/api/machines/photos/${a.id}`)}
                  aria-label="Открыть фото во весь экран"
                  className="block"
                >
                  <img
                    src={`/api/machines/photos/${a.id}`}
                    alt=""
                    loading="lazy"
                    className="h-24 w-24 rounded-lg border border-neutral-200 object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => removePhoto(a.id)}
                  aria-label="Удалить фото"
                  className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white text-neutral-500 shadow ring-1 ring-neutral-200 active:bg-neutral-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Поля карточки ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700">Карточка</h2>
          <Button variant="ghost" onClick={() => setEditing((v) => !v)} data-testid="machine-edit">
            {editing ? "Свернуть" : "Изменить"}
          </Button>
        </div>
        {editing ? (
          <MachineEditForm
            // Ключ по updatedAt: если карточку правил кто-то другой, форма пересоздаётся со свежими
            // значениями и не отправляет обратно устаревшие поля, затирая чужую правку.
            key={machine.updatedAt}
            machine={machine}
            busy={busy}
            responsibles={meta?.responsibles ?? []}
            models={meta?.models ?? []}
            onSave={async (patch) => {
              const ok = await send({ op: "edit", ...patch });
              if (ok) setEditing(false);
            }}
          />
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Комплектация" value={machine.configuration} />
            <Row label="Серийный номер" value={machine.serialNumber} />
            <Row label="Место на площадке" value={machine.location} />
            <Row label="Дата поступления" value={machine.arrivedAt ? formatDay(machine.arrivedAt) : null} />
            <Row label="Заказчик" value={machine.orgName} />
            <Row label="Контакт" value={machine.contactName} />
            <Row
              label="Телефон"
              value={machine.contactPhone}
              href={machine.contactPhone ? `tel:${machine.contactPhone}` : undefined}
            />
            <Row label="№ заказа 1С" value={machine.invoice1C} accent={machine.category === "CLIENT" && !machine.invoice1C} />
            <Row label="Ответственный" value={machine.responsibleName} />
            <Row label="Кто привёз" value={machine.deliveredBy} />
            <div className="sm:col-span-2">
              <Row label="Дефектовка" value={machine.defectNotes} block />
            </div>
          </dl>
        )}
      </section>

      {/* ── Комментарии: закреплённая заметка + лента (PRD §16.5, решение Артёма 07.08) ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">Комментарии</h2>

        {/* Закреплённая заметка — прежнее поле «Заметки», теперь всегда на виду и правится тут же. */}
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3" data-testid="machine-pinned-note">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-neutral-500">Закреплённая заметка</span>
            {pinnedEditing ? null : (
              <Button
                variant="ghost"
                className="!py-1 text-xs"
                disabled={busy}
                onClick={() => {
                  setPinnedDraft(machine.notes ?? "");
                  setPinnedEditing(true);
                }}
                data-testid="machine-pinned-edit"
              >
                {machine.notes ? "Изменить" : "Добавить"}
              </Button>
            )}
          </div>
          {pinnedEditing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                rows={2}
                value={pinnedDraft}
                onChange={(e) => setPinnedDraft(e.target.value)}
                placeholder="Заметка, которая всегда видна в карточке"
                data-testid="machine-pinned-input"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setPinnedEditing(false)}>
                  Отмена
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    const ok = await send({ op: "edit", notes: pinnedDraft });
                    if (ok) setPinnedEditing(false);
                  }}
                  data-testid="machine-pinned-save"
                >
                  Сохранить
                </Button>
              </div>
            </div>
          ) : machine.notes ? (
            <p className="whitespace-pre-wrap text-sm text-neutral-800">{machine.notes}</p>
          ) : (
            <p className="text-sm text-neutral-400">Пока пусто.</p>
          )}
        </div>

        {/* Ввод: многострочный, отправка только кнопкой (Enter — перенос строки, не отправка). */}
        <div className="mb-3 flex flex-col gap-2">
          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий к станку…"
            data-testid="machine-comment"
          />
          <Button
            onClick={sendComment}
            disabled={busy || !comment.trim()}
            className="self-end"
            data-testid="machine-comment-send"
          >
            Добавить комментарий
          </Button>
        </div>

        {comments.length === 0 ? (
          <p className="text-sm text-neutral-400">Комментариев пока нет.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="machine-comments">
            {comments.map((e) => (
              <li key={e.id} className="border-b border-neutral-100 pb-2 last:border-0">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-700">{e.actorName}</span>
                  <span>{formatMoment(e.at)}</span>
                </div>
                {e.comment ? (
                  <p className="whitespace-pre-wrap text-sm text-neutral-800">{e.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── История изменений: технические события, свёрнута — Максим чаще читает комментарии ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex min-h-12 w-full items-center justify-between text-left"
          data-testid="machine-history-toggle"
        >
          <span className="text-sm font-medium text-neutral-700">
            История изменений ({history.length})
          </span>
          <span className="text-sm text-neutral-400">{historyOpen ? "Скрыть" : "Показать"}</span>
        </button>
        {historyOpen ? (
          <ul className="mt-2 flex flex-col gap-2" data-testid="machine-events">
            {history.map((e) => (
              <li key={e.id} className="border-b border-neutral-100 pb-2 last:border-0">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-700">
                    {EVENT_LABEL[e.kind] ?? e.kind}
                  </span>
                  <span>{formatMoment(e.at)}</span>
                  <span>· {e.actorName}</span>
                </div>
                {e.kind === "status_change" && e.toStatus ? (
                  <p className="text-sm text-neutral-800">
                    {e.fromStatus ? `${MACHINE_STATUS_LABEL[e.fromStatus]} → ` : ""}
                    {MACHINE_STATUS_LABEL[e.toStatus]}
                  </p>
                ) : null}
                {e.changes.length > 0 ? (
                  <ul className="text-sm text-neutral-800">
                    {e.changes.map((c) => (
                      <li key={c.field}>
                        <span className="text-neutral-500">{c.label}:</span> {c.from ?? "—"} →{" "}
                        <span className="font-medium">{c.to ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {e.comment ? (
                  <p className="whitespace-pre-wrap text-sm text-neutral-800">{e.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {shopTaskOpen ? (
        <ShopTaskModal
          machine={machine}
          onClose={() => setShopTaskOpen(false)}
          onDone={(updated) => {
            mutate(updated, { revalidate: false });
          }}
        />
      ) : null}

      {lightbox ? <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

/** Последнее задание в цех — компактно, с разворотом длинного текста и повторным копированием. */
function LastShopTask({ event }: { event: MachineEventView }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = event.comment ?? "";
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3" data-testid="machine-last-shop-task">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-500">
          Последнее задание в цех · {formatMoment(event.at)} · {event.actorName}
        </span>
        <Button
          variant="ghost"
          className="!py-1 text-xs"
          onClick={async () => {
            // Повторное копирование события в журнал не пишет — задание то же самое.
            if (await copyText(text)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
          data-testid="machine-last-shop-task-copy"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "Скопировано" : "Скопировать ещё раз"}
        </Button>
      </div>
      <p
        className={cn("whitespace-pre-wrap text-sm text-neutral-800", !expanded && "line-clamp-3")}
      >
        {text}
      </p>
      {text.split("\n").length > 3 ? (
        <button
          type="button"
          className="mt-1 text-xs text-neutral-500 underline underline-offset-2"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Свернуть" : "Показать целиком"}
        </button>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  href,
  block,
  accent,
}: {
  label: string;
  value: string | null;
  href?: string;
  block?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={cn(block ? "flex flex-col gap-0.5" : "flex items-baseline gap-2")}>
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className={cn("text-neutral-900", accent && !value ? "text-amber-700" : "")}>
        {value ? (
          href ? (
            <a href={href} className="underline underline-offset-2">
              {value}
            </a>
          ) : (
            value
          )
        ) : accent ? (
          "не указан"
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

// Правка полей: отдельная форма, чтобы просмотр карточки оставался спокойным (Максим чаще смотрит,
// чем правит). Сохраняем одним PATCH — журнал сам посчитает «было→стало».
function MachineEditForm({
  machine,
  busy,
  responsibles,
  models,
  onSave,
}: {
  machine: MachineDetail;
  busy: boolean;
  responsibles: { id: string; name: string }[];
  models: string[];
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [f, setF] = useState({
    model: machine.model,
    kind: machine.kind,
    responsibleId: machine.responsibleId ?? "",
    ourNumber: machine.ourNumber === null ? "" : String(machine.ourNumber),
    configuration: machine.configuration ?? "",
    metalThickness: machine.metalThickness ?? "",
    serialNumber: machine.serialNumber ?? "",
    orgName: machine.orgName ?? "",
    contactName: machine.contactName ?? "",
    contactPhone: machine.contactPhone ?? "",
    invoice1C: machine.invoice1C ?? "",
    deliveredBy: machine.deliveredBy ?? "",
    location: machine.location ?? "",
    arrivedAt: machine.arrivedAt ?? "",
    dueDate: machine.dueDate ?? "",
    defectNotes: machine.defectNotes ?? "",
    isUrgent: machine.isUrgent,
  });
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Модель" required>
        <ModelCombobox
          value={f.model}
          onChange={(v) => set({ model: v })}
          models={models}
          testId="machine-edit-model"
        />
      </Field>
      <Field label="Вид">
        <Select
          value={f.kind}
          onChange={(e) => set({ kind: e.target.value as EquipmentKind })}
          data-testid="machine-edit-kind"
        >
          {EQUIPMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {EQUIPMENT_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      {isOurCategory(machine.category) ? (
        <Field label="Наш номер (77-N)">
          <Input
            type="number"
            inputMode="numeric"
            value={f.ourNumber}
            onChange={(e) => set({ ourNumber: e.target.value })}
          />
        </Field>
      ) : null}
      <Field label="Комплектация">
        <Input value={f.configuration} onChange={(e) => set({ configuration: e.target.value })} />
      </Field>
      <Field label="Толщина металла">
        <Input value={f.metalThickness} onChange={(e) => set({ metalThickness: e.target.value })} />
      </Field>
      <Field label="Серийный номер">
        <Input value={f.serialNumber} onChange={(e) => set({ serialNumber: e.target.value })} />
      </Field>
      <Field label="Место на площадке">
        <Input
          value={f.location}
          onChange={(e) => set({ location: e.target.value })}
          data-testid="machine-location"
        />
      </Field>
      <Field label="Заказчик">
        <Input value={f.orgName} onChange={(e) => set({ orgName: e.target.value })} />
      </Field>
      <Field label="Контакт">
        <Input value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} />
      </Field>
      <Field label="Телефон">
        <Input type="tel" value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} />
      </Field>
      <Field label="№ заказа 1С">
        <Input value={f.invoice1C} onChange={(e) => set({ invoice1C: e.target.value })} />
      </Field>
      <Field label="Кто привёз">
        <Input value={f.deliveredBy} onChange={(e) => set({ deliveredBy: e.target.value })} />
      </Field>
      <Field label="Ответственный">
        <Select
          value={f.responsibleId}
          onChange={(e) => set({ responsibleId: e.target.value })}
          data-testid="machine-responsible"
        >
          <option value="">Не выбран</option>
          {responsibles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Дата поступления">
        <DateField value={f.arrivedAt} onChange={(v) => set({ arrivedAt: v })} />
      </Field>
      <Field label="Срок готовности / выдачи">
        <DateField value={f.dueDate} onChange={(v) => set({ dueDate: v })} testId="machine-edit-due-date" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Дефектовка">
          <Textarea rows={2} value={f.defectNotes} onChange={(e) => set({ defectNotes: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={f.isUrgent}
          onChange={(e) => set({ isUrgent: e.target.checked })}
          className="h-4 w-4"
        />
        Срочный
      </label>
      <div className="flex justify-end sm:col-span-2">
        <Button
          disabled={busy}
          data-testid="machine-save-edit"
          onClick={() =>
            onSave({
              ...f,
              responsibleId: f.responsibleId || null,
              ourNumber: isOurCategory(machine.category) && f.ourNumber ? Number(f.ourNumber) : null,
            })
          }
        >
          Сохранить
        </Button>
      </div>
    </div>
  );
}
