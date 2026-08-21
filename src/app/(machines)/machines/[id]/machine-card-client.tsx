"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/machines/photos/:id по сессионной
   куке; next/image ходит через свой прокси без куки и получил бы 404. */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Camera, Copy, Factory, Pencil, Trash2 } from "lucide-react";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { BackLink } from "@/components/back-link";
import {
  EQUIPMENT_KIND_LABEL,
  KINDS_BY_FAMILY,
  isArchivedStatus,
  isStockKind,
  normalizeCategories,
  reasonRequiredFor,
  selectableStatuses,
} from "@/domain/machine-status";
import { machineDueState } from "@/domain/machine-flags";
import { machineNumberValue, numberFieldFor } from "@/domain/machine-number";
import { modelSuggestionPool } from "@/domain/machine-models";
import {
  EVENT_LABEL,
  MACHINE_STATUS_ACTIVE,
  MACHINE_STATUS_LABEL,
  NUMBER_PREFIX,
  numberSchemeFor,
  dueBadgeClass,
  formatDay,
  formatMoment,
  machineTitle,
} from "@/lib/machine-ui";
import { copyText } from "@/lib/clipboard";
import { StatusBadge } from "@/components/status-badge";
import { TASK_MACHINE_DIRECTION_LABEL } from "@/domain/task-machine-flow";
import type { MachineDetail, MachineEventView } from "@/lib/machine-dto";
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";
import { MachineCategoryBadge, MachineKindBadge, MachineStatusBadge } from "../_components/machine-badges";
import { CategoryCheckboxes } from "../_components/category-checkboxes";
import { ModelCombobox } from "../_components/model-combobox";
import { ShopTaskModal } from "./shop-task-modal";
import { ChecksBanner } from "./checks-banner";
import { ChoiceRows } from "@/components/ui/choice-rows";
import { ConfigurationField } from "../_components/configuration-field";
import { KitPanel } from "./kit-panel";
import { StatusKitModal } from "./status-kit-modal";
import { uploadMachinePhotos } from "@/lib/machine-photo-upload";

export function MachineCardClient({
  id,
  initial,
  basePath = "/machines",
  canOpenTasks = false,
}: {
  id: string;
  initial: MachineDetail;
  basePath?: string;
  /**
   * Можно ли открыть заявку из блока «Заявки» (21.08.2026). Ссылку даём только тем, кто ведёт
   * заявки (isTaskManagerRole) — водителю с персональным допуском к оборудованию раздел заявок
   * диспетчера закрыт, и ссылка вела бы его в отказ. Номер заявки при этом видит каждый: это
   * история станка, а не чужие данные.
   */
  canOpenTasks?: boolean;
}) {
  const { data: machine = initial, mutate } = useSWR<MachineDetail>(
    `/api/machines/${id}`,
    fetcher,
    { fallbackData: initial, revalidateOnFocus: true },
  );
  // Справочники формы: сотрудники офиса для «Ответственного» и модели для подсказок комбобокса.
  const { data: meta } = useSWR<{
    responsibles: { id: string; name: string }[];
    models: string[];
    suppressedModels: string[];
  }>(`/api/machines/meta?family=${initial.family}`, fetcher);
  // Пул подсказок «Модели» собирается так же, как в форме заведения: базовый справочник + реально
  // введённые названия минус скрытые крестиком. Сырой список из БД (как было здесь раньше) оставлял
  // правку без справочника — те же 25 моделей приходилось набирать руками.
  const modelPool = useMemo(
    () => modelSuggestionPool(meta?.models ?? [], meta?.suppressedModels ?? []),
    [meta?.models, meta?.suppressedModels],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Лайтбокс держит ИНДЕКС фото, а не адрес: просмотрщик листает весь набор карточки (Артём 20.08.2026).
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [shopTaskOpen, setShopTaskOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pinnedEditing, setPinnedEditing] = useState(false);
  const [pinnedDraft, setPinnedDraft] = useState("");
  // Состояние, которое ждёт подтверждения в переспросе про комплект (null — переспроса нет).
  const [pendingStatus, setPendingStatus] = useState<MachineStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);

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
    // Собран комплект — спрашиваем отдельным окном: там и состав, и галочка «перевести вместе»
    // (включена), и поле причины. confirm() галочку показать не умеет.
    const activeKit = machine.kitParts.filter((p) => p.consumedAt === null);
    if (activeKit.length > 0) {
      setPendingStatus(next);
      return;
    }
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

  // Категорий у станка может быть несколько (20.08.2026), и на сервер уходит ПОЛНЫЙ набор галочек:
  // так комбинация проверяется целиком и станок не проваливается в состояние «ни одной категории».
  async function changeCategories(next: MachineCategory[]) {
    const normalized = normalizeCategories(next);
    if (normalized.length === 0) return; // последнюю галочку снять нельзя — молча игнорируем
    if (normalized.join() === normalizeCategories(machine.categories).join()) return;
    await send({ op: "category", categories: normalized });
  }

  // Кнопка «Редактировать» в шапке (Артём 20.08.2026: правку в карточке просто не находили — она
  // жила внизу, в блоке «Карточка»). Сама форма остаётся там же, поэтому после включения режима
  // прокручиваем к ней: иначе нажатие выглядит как «ничего не произошло».
  function startEdit() {
    setEditing(true);
    requestAnimationFrame(() =>
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
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
  const stock = isStockKind(machine.kind);
  // Комментарии живут отдельной лентой, технические события — в сворачиваемой «Истории».
  const comments = machine.events.filter((e) => e.kind === "comment");
  const history = machine.events.filter((e) => e.kind !== "comment");
  // События отсортированы свежие-сверху — первый shop_task и есть последнее задание в цех.
  const lastShopTask = machine.events.find((e) => e.kind === "shop_task") ?? null;
  const dueState = machineDueState(machine, new Date());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <BackLink href={basePath} className="self-start !text-base !py-2">
        {basePath === "/seamers" ? "Фальцепрокатники" : "Листогибы"}
      </BackLink>

      <header className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-neutral-900" data-testid="machine-title">
            {machineTitle(machine)}
          </h1>
          <MachineStatusBadge status={machine.status} size="md" />
          <MachineKindBadge kind={machine.kind} />
          <MachineCategoryBadge categories={machine.categories} />
          {machine.isUrgent ? (
            <span className="rounded border border-amber-500 px-2 py-0.5 text-xs font-medium text-amber-700">
              Срочный
            </span>
          ) : null}
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={startEdit}
            data-testid="machine-edit-header"
          >
            <Pencil className="h-4 w-4" />
            Редактировать
          </Button>
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

      {/* Обязательные отметки — над «Состоянием», как незакрытая смена над доской (Артём 20.08.2026).
          Не показываем там, где осмотр требовать не с кого: станок в аренде стоит у клиента, архивный
          уехал с площадки, а у складского остатка отметок не бывает вовсе. */}
      {!stock &&
      !archived &&
      machine.status !== "RENTED" &&
      (!machine.diagnosedAt || !machine.lastVerifiedAt) ? (
        <ChecksBanner
          diagnosedAt={machine.diagnosedAt}
          lastVerifiedAt={machine.lastVerifiedAt}
          busy={busy}
          onMark={(op) => void send({ op })}
        />
      ) : null}

      {/* Складская позиция (размотчик, частотник) — остаток, а не станок: ни состояния, ни
          категории, ни срока у неё нет. Вместо всего этого одно поле «На складе». */}
      {stock ? (
        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="w-40">
            <Field label="На складе, шт">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={machine.quantity}
                disabled={busy}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next !== machine.quantity) {
                    void send({ op: "edit", quantity: Math.trunc(next) });
                  }
                }}
                data-testid="machine-stock-quantity"
              />
            </Field>
          </div>
          <p className="text-xs text-neutral-500">
            Свободно {machine.freeQuantity} из {machine.quantity} шт — остальное стоит в комплектах.
          </p>
        </section>
      ) : (
        /* ── Состояние и категории ── */
      <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        {/* Состояние — ряд кнопок (Артём 15.08.2026): весь путь станка виден сразу, «Продан» и
            «В аренде» не приходится искать в выпадашке, и попасть пальцем проще, чем в список.
            У своего железа доступны и «Продан», и «В аренде» — категория переедет сама. */}
        <Field label="Состояние">
          <div className="flex flex-wrap gap-2" data-testid="machine-status-buttons">
            {selectableStatuses(machine.categories).map((s) => {
              const active = s === machine.status;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  aria-pressed={active}
                  onClick={() => changeStatus(s)}
                  data-testid={`machine-status-btn-${s}`}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-50",
                    active
                      ? MACHINE_STATUS_ACTIVE[s]
                      : s === "VOIDED"
                        ? "border-neutral-200 bg-white text-red-700 hover:border-red-400"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400",
                  )}
                >
                  {MACHINE_STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Категории — галочки, а не выпадашка (Артём 20.08.2026: «мне очень не нравятся выпадающие
            списки»), и выбор теперь множественный: наш станок бывает и на продажу, и арендным.
            Подпись — обычный span, а не Field: тот сам по себе <label>, и вложенные в него галочки
            щёлкали бы мимо. */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-700">Категории</span>
          <CategoryCheckboxes
            value={machine.categories}
            onChange={(next) => void changeCategories(next)}
            disabled={busy}
          />
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
        </div>
        {/* Кнопки отметок переехали наверх, в янтарный баннер: здесь остаётся только строка с датами
            — по ней видно, когда станок смотрели в последний раз. */}
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
      )}

      {/* ── Заявки, по которым станок везли (21.08.2026, PRD §16.1) ──
          Отвечает на вопрос «куда он делся»: раньше перемещения жили только в заявке, и связать
          их с карточкой можно было лишь по памяти. У складских остатков заявок не бывает. */}
      {!stock && machine.tasks.length > 0 ? (
        <section
          className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4"
          data-testid="machine-tasks"
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Заявки
          </h2>
          <ul className="flex flex-col">
            {machine.tasks.map((t) => (
              <li
                key={t.taskId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-100 py-2 last:border-0"
              >
                <MachineTaskRef taskId={t.taskId} number={t.taskNumber} canOpen={canOpenTasks} />
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{t.title}</span>
                <span className="text-xs text-neutral-500">
                  {t.typeName} · {TASK_MACHINE_DIRECTION_LABEL[t.direction].toLowerCase()}
                </span>
                {t.archived ? (
                  <span className="rounded border border-slate-300 px-1.5 text-xs text-slate-500">
                    в архиве
                  </span>
                ) : null}
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Комплект: что уезжает вместе со станком (15.08.2026) ── */}
      <KitPanel
        machine={machine}
        basePath={basePath}
        disabled={busy || archived}
        onChanged={(updated) => void mutate(updated, { revalidate: false })}
      />

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
            {machine.attachments.map((a, i) => (
              <li key={a.id} className="relative">
                <button
                  type="button"
                  onClick={() => setLightbox(i)}
                  aria-label="Открыть фото во весь экран"
                  className="block"
                >
                  <img
                    src={`/api/machines/photos/${a.id}`}
                    alt=""
                    loading="lazy"
                    className="h-32 w-32 rounded-lg border border-neutral-200 object-cover sm:h-40 sm:w-40"
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
      <section ref={cardRef} className="rounded-lg border border-neutral-200 bg-white p-4">
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
            models={modelPool}
            onSave={async (patch) => {
              const ok = await send({ op: "edit", ...patch });
              if (ok) setEditing(false);
            }}
          />
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Комплектация" value={machine.configuration} />
            {/* Толщина металла не дублируется: она стоит в шапке рядом с моделью.
                Цена — рубли целыми, с разделителем разрядов: «1 250 000 ₽» читается с одного взгляда. */}
            <Row
              label="Цена"
              value={machine.price === null ? null : `${machine.price.toLocaleString("ru-RU")} ₽`}
            />
            <Row label="Дата поступления" value={machine.arrivedAt ? formatDay(machine.arrivedAt) : null} />
            <Row label="Контакт" value={machine.contactName} />
            <Row
              label="№ заказа 1С"
              value={machine.invoice1C}
            />
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

      {/* Переспрос при смене состояния станка с собранным комплектом (15.08.2026). */}
      <StatusKitModal
        open={pendingStatus !== null}
        status={pendingStatus}
        parts={machine.kitParts.filter((p) => p.consumedAt === null)}
        consumes={pendingStatus === "SOLD" || pendingStatus === "RELEASED"}
        reasonRequired={pendingStatus !== null && reasonRequiredFor(pendingStatus)}
        onCancel={() => setPendingStatus(null)}
        onConfirm={async ({ withKit, reason }) => {
          const next = pendingStatus;
          setPendingStatus(null);
          if (next) await send({ op: "status", status: next, reason, withKit });
        }}
      />

      {shopTaskOpen ? (
        <ShopTaskModal
          machine={machine}
          onClose={() => setShopTaskOpen(false)}
          onDone={(updated) => {
            mutate(updated, { revalidate: false });
          }}
        />
      ) : null}

      {lightbox !== null ? (
        <PhotoLightbox
          urls={machine.attachments.map((a) => `/api/machines/photos/${a.id}`)}
          index={lightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Номер заявки в блоке «Заявки». Ссылкой — только тем, кто ведёт заявки: у водителя с персональным
 * допуском к оборудованию раздел заявок диспетчера закрыт, и ссылка вела бы его в отказ. Сам номер
 * показываем всем — это история станка.
 */
function MachineTaskRef({
  taskId,
  number,
  canOpen,
}: {
  taskId: string;
  number: number;
  canOpen: boolean;
}) {
  const label = `№${number}`;
  if (!canOpen) return <span className="text-sm font-medium text-neutral-900">{label}</span>;
  return (
    <Link
      href={`/tasks/${taskId}`}
      className="text-sm font-medium text-blue-700 hover:underline"
      data-testid={`machine-task-link-${number}`}
    >
      {label}
    </Link>
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

// Янтарной подсветки пустых значений здесь больше нет: единственным её случаем был «клиентский без
// заказа 1С», а этот индикатор убран целиком 20.08.2026 (решение Артёма).
function Row({
  label,
  value,
  href,
  block,
}: {
  label: string;
  value: string | null;
  href?: string;
  block?: boolean;
}) {
  return (
    <div className={cn(block ? "flex flex-col gap-0.5" : "flex items-baseline gap-2")}>
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">
        {value ? (
          href ? (
            <a href={href} className="underline underline-offset-2">
              {value}
            </a>
          ) : (
            value
          )
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
    number: machineNumberValue(machine) === null ? "" : String(machineNumberValue(machine)),
    configuration: machine.configuration ?? "",
    metalThickness: machine.metalThickness ?? "",
    // Цена живёт в состоянии строкой: пустое поле — это «цены нет» (null), а не 0.
    price: machine.price === null ? "" : String(machine.price),
    contactName: machine.contactName ?? "",
    invoice1C: machine.invoice1C ?? "",
    deliveredBy: machine.deliveredBy ?? "",
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
      {/* Вид и ответственный — строками с галочкой, как везде в разделе с 20.08.2026: выпадашки
          Артём просил не использовать, а вариантов тут единицы. */}
      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700">Вид</p>
        <ChoiceRows
          ariaLabel="Вид оборудования"
          value={f.kind}
          onChange={(v) => set({ kind: v as EquipmentKind })}
          testIdPrefix="machine-edit-kind"
          options={KINDS_BY_FAMILY[machine.family].map((k) => ({
            value: k,
            label: EQUIPMENT_KIND_LABEL[k],
          }))}
        />
      </div>
      {/* Номер — в схеме своего происхождения: «77-N» у своего парка, «К-N» у клиентского. Переезд
          между схемами делает смена категорий (она же выдаёт следующий свободный), здесь номер
          только правится вручную. */}
      <Field label={`Учётный номер (${NUMBER_PREFIX[numberSchemeFor(machine.categories)]}N)`}>
        <Input
          type="number"
          inputMode="numeric"
          value={f.number}
          onChange={(e) => set({ number: e.target.value })}
        />
      </Field>
      {/* Комплектация галочками и в правке (20.08.2026): весь уже заведённый парк набран свободным
          текстом, и если бы правка осталась строкой, разнобой написаний никуда бы не делся. */}
      <ConfigurationField
        kind={f.kind}
        value={f.configuration}
        onChange={(v) => set({ configuration: v })}
        testId="machine-edit-configuration"
      />
      <Field label="Толщина металла">
        <Input value={f.metalThickness} onChange={(e) => set({ metalThickness: e.target.value })} />
      </Field>
      <Field label="Цена, ₽">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={f.price}
          onChange={(e) => set({ price: e.target.value })}
          data-testid="machine-edit-price"
        />
      </Field>
      <Field label="Контакт">
        <Input value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} />
      </Field>
      <Field label="№ заказа 1С">
        <Input value={f.invoice1C} onChange={(e) => set({ invoice1C: e.target.value })} />
      </Field>
      <Field label="Кто привёз">
        <Input value={f.deliveredBy} onChange={(e) => set({ deliveredBy: e.target.value })} />
      </Field>
      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700">Ответственный</p>
        <ChoiceRows
          ariaLabel="Ответственный"
          value={f.responsibleId}
          onChange={(v) => set({ responsibleId: v })}
          testIdPrefix="machine-responsible"
          options={[
            { value: "", label: "Не выбран" },
            ...responsibles.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      </div>
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
              // Пустая цена — null («стереть»), мусорный ввод тоже: число обязано быть числом.
              price: Number.isFinite(Number(f.price)) && f.price.trim() !== "" ? Number(f.price) : null,
              [numberFieldFor(machine.categories)]: f.number ? Number(f.number) : null,
            })
          }
        >
          Сохранить
        </Button>
      </div>
    </div>
  );
}
