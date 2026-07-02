"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/attachments/:id с проверкой
   прав по сессионной куке; next/image оптимизирует через свой прокси без куки и получил бы 404. */

import { useRef, useState } from "react";
import useSWR from "swr";
import { Phone, Navigation, Loader2, Camera, X, FileText } from "lucide-react";
import { ApiError } from "@/lib/fetcher";
import { cachedFetcher } from "@/lib/offline/cached-fetcher";
import { useOnline } from "@/lib/offline/net";
import { enqueueOrSend, enqueuePhoto } from "@/lib/offline/send";
import { usePendingActions } from "@/lib/offline/use-queue";
import { overlayStatus, hasConflict } from "@/lib/offline/overlay";
import { getPositionOnce } from "@/lib/geo";
import { compressImage } from "@/lib/image-compress";
import type { TaskDetailDTO, WorkCatalogItemDTO } from "@/lib/task-dto";
import type { TaskStatus } from "@/generated/prisma/enums";
import {
  STATUS_LABEL,
  PASS_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  navUrl,
  todayISO,
} from "@/lib/task-ui";
import { StatusBadge } from "@/components/status-badge";
import { TypeIcon } from "@/components/type-icon";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { BackLink } from "@/components/back-link";

// Подсказка для UI: следующий статус по водительской цепочке. Сервер всё равно проверяет матрицу.
// Переработка (этап A): цепочка схлопнута — «В работу» (взять) → «Завершить». Из паузы — «Вернуть в работу».
const NEXT: Partial<Record<TaskStatus, { to: TaskStatus; label: string; cls: string }>> = {
  ASSIGNED: { to: "IN_PROGRESS", label: "В работу", cls: "bg-indigo-600 active:bg-indigo-700" },
  IN_PROGRESS: { to: "DONE", label: "Завершить", cls: "bg-green-600 active:bg-green-700" },
  ON_HOLD: { to: "IN_PROGRESS", label: "Вернуть в работу", cls: "bg-indigo-600 active:bg-indigo-700" },
};

// Пауза «На паузе» — только из активной работы (с обязательной причиной).
const CAN_HOLD: TaskStatus[] = ["IN_PROGRESS"];

const KIND_LABEL: Record<string, string> = {
  created: "Создана",
  status_change: "Статус",
  assign: "Назначение",
  edit: "Изменение",
  reschedule: "Перенос",
  auto_date: "Дата",
  comment: "Комментарий",
  payment_received: "Оплата",
  act_missing_reason: "Акт",
  worksheet_submitted: "Ведомость",
  worksheet_priced: "Расценка",
  worksheet_repriced: "Цена исправлена",
  worksheet_signed: "Акт",
  worksheet_unsigned: "Акт",
};

type StatusExtra = {
  reason?: string;
  comment?: string;
  paymentConfirmed?: boolean;
  paymentAmount?: number | null;
  paymentMissedReason?: string; // завершение без оплаты «на месте»: причина (№8)
  actMissedReason?: string; // завершение актовой задачи без акта: причина (акты до 20:00, 02.07)
};

// Типовые причины неоплаты «на месте» (№8, формулировки Артёма 23.06). «Другое» требует комментарий.
const UNPAID_REASONS = ["Оплатят по счёту", "Оплата через офис", "Спор по сумме/работам", "Другое"];

// Причины «завершаю без акта» (акты до 20:00, формулировки Артёма 02.07). Выбор обязателен,
// но информационен: завершение не блокирует, Милена видит причину в кандидате нарушения.
const ACT_MISSED_REASONS = [
  "Акт не нужен (распоряжение офиса)",
  "Не могу приложить (личная причина)",
];

// Группирует справочник по разделам (для optgroup). Порядок сохраняется (сервер уже отдаёт по
// разделу→позиции); позиции без раздела (categoryName=null) идут своей группой без заголовка.
function groupCatalog(items: WorkCatalogItemDTO[]): { name: string | null; items: WorkCatalogItemDTO[] }[] {
  const groups: { name: string | null; items: WorkCatalogItemDTO[] }[] = [];
  for (const c of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === c.categoryName) last.items.push(c);
    else groups.push({ name: c.categoryName, items: [c] });
  }
  return groups;
}

export function DriverTaskClient({ taskId }: { taskId: string }) {
  const key = `/api/tasks/${taskId}`;
  const online = useOnline();
  // cachedFetcher: при связи кэширует ответ, без связи отдаёт сохранённое — карточка открывается офлайн.
  const { data: task, error, isLoading, mutate } = useSWR<TaskDetailDTO>(key, cachedFetcher, {
    refreshInterval: 10_000,
  });
  // Справочник работ для ведомости — грузим только для типов с расценкой (этап 12).
  const { data: workCatalog = [] } = useSWR<WorkCatalogItemDTO[]>(
    task?.type.requiresPricing ? "/api/work-catalog" : null,
    cachedFetcher,
  );
  // Одна активная задача (этап B): знаем про другую задачу водителя «В работе», чтобы заранее
  // заблокировать кнопку «В работу» (сервер всё равно запретит — это проактивная подсказка в UI).
  const { data: myToday = [] } = useSWR<{ id: string; status: TaskStatus; number: number }[]>(
    `/api/my/tasks?date=${todayISO()}&scope=today`,
    cachedFetcher,
    { refreshInterval: 10_000 },
  );
  // Открытая смена нужна, чтобы брать задачу в работу (этап D). Кэшируем статус: смену открывают
  // утром онлайн, а взять задачу могут уже офлайн на объекте — нужен последний известный статус.
  const { data: myShift } = useSWR<{ status: string } | null>(
    `/api/my/shift?date=${todayISO()}`,
    cachedFetcher,
    { refreshInterval: 10_000 },
  );
  // Действия этой задачи, ещё не дошедшие до сервера (офлайн-очередь): для оверлея статуса и бейджей.
  const pending = usePendingActions(taskId);

  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Полноэкранный просмотр фото (URL вложения) — закрытие крестиком/свайпом/«назад».
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  // экран завершения
  const [completionOpen, setCompletionOpen] = useState(false);
  // Оплата при ON_SITE-завершении (№8): выбор «получено / не получено» + причина неоплаты.
  const [payChoice, setPayChoice] = useState<"" | "paid" | "unpaid">("");
  const [missReason, setMissReason] = useState(""); // выбранная типовая причина
  const [missOther, setMissOther] = useState(""); // свой текст для «Другое»
  const [actReasonChoice, setActReasonChoice] = useState(""); // причина «завершаю без акта» (02.07)
  const [amountInput, setAmountInput] = useState("");
  const [doneComment, setDoneComment] = useState("");
  // Ведомость работ (этап 12): выбор работы (из справочника или свободная) + количество.
  const [workSel, setWorkSel] = useState("");
  const [workFree, setWorkFree] = useState("");
  const [workQty, setWorkQty] = useState("1");
  const [wsBusy, setWsBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null);

  if (isLoading) return <p className="p-6 text-base text-neutral-400">Загрузка…</p>;
  if (error || !task) {
    return (
      <div className="p-6">
        <p className="text-base text-red-600">Задача недоступна.</p>
        <BackLink href="/m" className="mt-2">
          Мои задачи
        </BackLink>
      </div>
    );
  }
  const t = task;
  // Статус с учётом неотправленных переходов из очереди (оптимистично, пока действие не дошло).
  const displayStatus = overlayStatus(t.status, pending);
  const pendingCount = pending.filter((a) => a.status === "pending" || a.status === "syncing").length;
  const conflict = hasConflict(pending);
  const pendingPhotos = pending.filter((a) => a.kind === "attachment" && a.blobMeta?.kind === "PHOTO").length;
  const pendingDocs = pending.filter((a) => a.kind === "attachment" && a.blobMeta?.kind === "DOCUMENT").length;

  const myPhotos = t.attachments.filter((a) => a.kind === "PHOTO" && a.createdById === t.assigneeId);
  const refPhotos = t.attachments.filter((a) => a.kind === "PHOTO" && a.createdById !== t.assigneeId);
  const docs = t.attachments.filter((a) => a.kind === "DOCUMENT");
  const requiresSignedDoc = t.requiresSignedDoc; // требование акта на уровне задачи (этап 11; не блокирует DONE)
  const requiresPricing = t.type.requiresPricing; // ведомость работ + расценка (этап 12)
  const ws = t.worksheetStatus;
  const wsEditable = requiresPricing && (ws === null || ws === "DRAFT");
  const worksheetTotal = t.workItems.reduce((s, w) => s + (w.price ?? 0) * w.quantity, 0);
  const onSite = t.paymentType === "ON_SITE";
  // Завершить можно: не ON_SITE; либо деньги получены; либо явно не получены с выбранной причиной (№8).
  const missReady = missReason !== "" && (missReason !== "Другое" || missOther.trim() !== "");
  const payReady = !onSite || payChoice === "paid" || (payChoice === "unpaid" && missReady);
  // Акты до 20:00 (02.07): актовая задача без акта (ни на сервере, ни в офлайн-очереди) — при
  // завершении обязателен выбор причины. Информационно: завершение не блокируется.
  const actReasonNeeded = requiresSignedDoc && docs.length === 0 && pendingDocs === 0;
  const canComplete = payReady && (!actReasonNeeded || actReasonChoice !== "");
  // фото — по желанию (не блокирует); акт — мягкая отметка KPI

  async function changeStatus(to: TaskStatus, extra: StatusExtra = {}) {
    setActionError(null);
    setBusy(true);
    try {
      const coords = await getPositionOnce(); // гео best-effort, не блокирует
      // Онлайн — отправляем сразу; офлайн/нет сети — в очередь (оверлей сразу покажет новый статус).
      const { queued } = await enqueueOrSend({
        kind: "transition",
        method: "POST",
        url: `${key}/transition`,
        taskId,
        bodyJson: {
          toStatus: to,
          reason: extra.reason,
          comment: extra.comment,
          paymentConfirmed: extra.paymentConfirmed,
          paymentAmount: extra.paymentAmount,
          paymentMissedReason: extra.paymentMissedReason, // завершение без оплаты «на месте» (№8)
          actMissedReason: extra.actMissedReason, // завершение без акта: причина (02.07)
          lat: coords?.lat,
          lng: coords?.lng,
        },
      });
      setHoldOpen(false);
      setReason("");
      setCompletionOpen(false);
      if (!queued) await mutate(); // онлайн-успех — подтянуть реальные данные
    } catch (e) {
      // Доменная ошибка (недопустимый переход, нет смены и т.п.) — показываем причину.
      setActionError(e instanceof ApiError ? e.message : "Не удалось сменить статус");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setActionError(null);
    setPhotoBusy(true);
    try {
      let queuedAny = false;
      for (const file of Array.from(files)) {
        const blob = await compressImage(file); // сжатие до ~1920px на клиенте
        // Офлайн — фото сохраняется в очередь (blob в IndexedDB) и досылается при связи.
        const { queued } = await enqueuePhoto({ url: `${key}/attachments`, taskId, blob, fileName: "photo.jpg", kind: "PHOTO" });
        queuedAny = queuedAny || queued;
      }
      if (!queuedAny) await mutate();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Не удалось загрузить фото");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function uploadDoc(files: FileList | null) {
    if (!files || files.length === 0) return;
    setActionError(null);
    setPhotoBusy(true);
    try {
      let queuedAny = false;
      for (const file of Array.from(files)) {
        const isPdf = file.type === "application/pdf";
        const blob = isPdf ? file : await compressImage(file); // фото акта сжимаем, PDF — как есть
        const { queued } = await enqueuePhoto({
          url: `${key}/attachments`,
          taskId,
          blob,
          fileName: isPdf ? "akt.pdf" : "akt.jpg",
          kind: "DOCUMENT",
        });
        queuedAny = queuedAny || queued;
      }
      if (!queuedAny) await mutate();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Не удалось приложить акт");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto(id: string) {
    setActionError(null);
    setPhotoBusy(true);
    try {
      const { queued } = await enqueueOrSend({
        kind: "attachment-delete",
        method: "DELETE",
        url: `/api/attachments/${id}`,
        taskId,
      });
      if (!queued) await mutate();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Не удалось удалить фото");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function addWorkItem() {
    if (!workSel && !workFree.trim()) return;
    const qty = Math.max(1, Number.parseInt(workQty, 10) || 1);
    const body = workSel ? { catalogItemId: workSel, quantity: qty } : { name: workFree.trim(), quantity: qty };
    setActionError(null);
    setWsBusy(true);
    try {
      const { queued } = await enqueueOrSend({
        kind: "work-item-add",
        method: "POST",
        url: `${key}/work-items`,
        taskId,
        bodyJson: body,
      });
      setWorkSel("");
      setWorkFree("");
      setWorkQty("1");
      if (!queued) await mutate();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Не удалось добавить работу");
    } finally {
      setWsBusy(false);
    }
  }

  async function removeWorkItem(id: string) {
    setActionError(null);
    setWsBusy(true);
    try {
      const { queued } = await enqueueOrSend({
        kind: "work-item-delete",
        method: "DELETE",
        url: `/api/work-items/${id}`,
        taskId,
      });
      if (!queued) await mutate();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Не удалось удалить работу");
    } finally {
      setWsBusy(false);
    }
  }

  async function submitWorksheet() {
    setActionError(null);
    setWsBusy(true);
    try {
      const { queued } = await enqueueOrSend({
        kind: "worksheet-submit",
        method: "POST",
        url: `${key}/worksheet/submit`,
        taskId,
      });
      if (!queued) await mutate();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Не удалось отправить ведомость");
    } finally {
      setWsBusy(false);
    }
  }

  function openCompletion() {
    setAmountInput(t.paymentAmount != null ? String(t.paymentAmount) : "");
    setPayChoice("");
    setMissReason("");
    setMissOther("");
    setActReasonChoice("");
    setDoneComment("");
    setActionError(null);
    setCompletionOpen(true);
  }

  function submitCompletion() {
    const finalReason = missReason === "Другое" ? missOther.trim() : missReason;
    void changeStatus("DONE", {
      comment: doneComment.trim() || undefined,
      paymentConfirmed: onSite ? payChoice === "paid" : undefined,
      paymentAmount: onSite && payChoice === "paid" ? Number(amountInput) || null : undefined,
      paymentMissedReason: onSite && payChoice === "unpaid" ? finalReason || undefined : undefined,
      actMissedReason: actReasonNeeded ? actReasonChoice || undefined : undefined,
    });
  }

  async function sendComment() {
    const text = comment.trim();
    if (!text) return;
    setActionError(null);
    setBusy(true);
    try {
      const { queued } = await enqueueOrSend({
        kind: "comment",
        method: "POST",
        url: `${key}/comments`,
        taskId,
        bodyJson: { text },
      });
      setComment("");
      if (!queued) await mutate();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  }

  const next = NEXT[displayStatus];
  const canHold = CAN_HOLD.includes(displayStatus);
  // Одна активная задача (этап B): если уже есть другая «В работе», кнопку взятия блокируем.
  const activeOther = myToday.find((x) => x.status === "IN_PROGRESS" && x.id !== t.id);
  const blockedByActive = next?.to === "IN_PROGRESS" && !!activeOther;
  // Открытая смена (этап D): без неё взять задачу в работу нельзя.
  const shiftOpen = myShift?.status === "REQUESTED" || myShift?.status === "OPEN";
  const blockedNoShift = next?.to === "IN_PROGRESS" && !shiftOpen;

  return (
    <div className="pb-44">
      {!online ? (
        <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-700">
          Офлайн — показываю сохранённое
        </p>
      ) : null}
      {/* Шапка */}
      <div className="border-b border-neutral-100 px-4 py-3">
        <BackLink href="/m">Мои задачи</BackLink>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-lg font-semibold text-neutral-700">
            <TypeIcon name={t.type.icon} className="h-6 w-6" />
            №{t.number}
            {t.priority ? (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                Срочно
              </span>
            ) : null}
          </span>
          <StatusBadge status={displayStatus} className="text-sm" />
        </div>
        <h1 className="mt-1 text-xl font-bold leading-snug text-neutral-900">{t.title}</h1>
        <p className="mt-1 text-base font-semibold text-neutral-700">{t.type.name}</p>
      </div>

      {/* Пропуск — крупный индикатор */}
      {t.passStatus !== "NOT_NEEDED" ? (
        <div
          className={`px-4 py-3 text-center text-base font-semibold ${
            t.passStatus === "NEEDED" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-800"
          }`}
        >
          {PASS_LABEL[t.passStatus]}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 p-4">
        {/* Адрес + Навигатор */}
        <section className="rounded-xl border border-neutral-200 p-3">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Адрес</p>
          <p className="mt-1 text-base text-neutral-900">{t.address}</p>
          <a
            href={navUrl(t.addressLink, t.address)}
            target="_blank"
            rel="noopener"
            className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-base font-medium text-white"
          >
            <Navigation className="h-5 w-5" /> Навигатор
          </a>
        </section>

        {/* Контакт + Позвонить */}
        {t.contactName || t.contactPhone ? (
          <section className="rounded-xl border border-neutral-200 p-3">
            <p className="text-xs uppercase tracking-wide text-neutral-400">Контакт</p>
            {t.contactName ? <p className="mt-1 text-base text-neutral-900">{t.contactName}</p> : null}
            {t.contactPhone ? (
              <a
                href={`tel:${t.contactPhone}`}
                className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-green-600 text-base font-medium text-white"
              >
                <Phone className="h-5 w-5" /> Позвонить · {t.contactPhone}
              </a>
            ) : null}
          </section>
        ) : null}

        {/* Оплата — крупно при оплате на месте */}
        {onSite ? (
          <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">Взять оплату на месте</p>
            <p className="mt-0.5 text-2xl font-bold text-amber-900">
              {t.paymentAmount ? formatMoney(t.paymentAmount) : "сумма не указана"}
            </p>
            {t.paymentNote ? <p className="mt-0.5 text-sm text-amber-800">{t.paymentNote}</p> : null}
          </section>
        ) : t.paymentType === "OFFICE" ? (
          <section className="rounded-xl border border-neutral-200 p-3 text-sm text-neutral-600">
            Оплата через офис{t.paymentNote ? ` · ${t.paymentNote}` : ""}
          </section>
        ) : null}

        {/* Прочие поля */}
        {t.orgName ||
        t.equipment ||
        t.invoiceNumber ||
        t.scheduledDate ||
        t.timeFrom ||
        t.timeTo ||
        t.timeNote ||
        t.description ? (
          <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-neutral-200 p-3">
            {t.orgName ? <Row label="Организация">{t.orgName}</Row> : null}
            {t.equipment ? <Row label="Оборудование">{t.equipment}</Row> : null}
            {t.invoiceNumber ? <Row label="Счёт">{t.invoiceNumber}</Row> : null}
            <Row label="Дата">{t.scheduledDate ? formatDate(t.scheduledDate) : "Без даты"}</Row>
            {t.timeFrom || t.timeTo || t.timeNote ? (
              <Row label="Время">
                {t.timeFrom || t.timeTo
                  ? `${t.timeFrom ?? ""}${t.timeTo ? "–" + t.timeTo : ""} `
                  : ""}
                {t.timeNote ?? ""}
              </Row>
            ) : null}
            {t.description ? (
              <div className="col-span-2">
                <Row label="Описание">{t.description}</Row>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Фото от диспетчера (что приложили при постановке — поломка и т.п.) */}
        {refPhotos.length > 0 ? (
          <section className="rounded-xl border border-neutral-200 p-3">
            <p className="text-xs uppercase tracking-wide text-neutral-400">Фото от диспетчера</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {refPhotos.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setLightbox(`/api/attachments/${a.id}`)}
                  className="block"
                >
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt="фото от диспетчера"
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Отчётные фото (мои) — видны и вне экрана завершения */}
        {myPhotos.length > 0 ? (
          <section className="rounded-xl border border-neutral-200 p-3">
            <p className="text-xs uppercase tracking-wide text-neutral-400">Моё фото отчёта</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {myPhotos.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setLightbox(`/api/attachments/${a.id}`)}
                  className="block"
                >
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt="фото отчёта"
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Полноэкранный просмотр фото (крестик / свайп вверх-вниз / «назад») */}
        {lightbox ? <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} /> : null}

        {/* Ведомость работ — типы с расценкой (этап 12). Водитель фиксирует работы без цен. */}
        {requiresPricing ? (
          <section className="rounded-xl border border-neutral-200 p-3">
            <p className="text-xs uppercase tracking-wide text-neutral-400">Ведомость работ</p>
            {t.workItems.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {t.workItems.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-neutral-800">
                      {w.name} · {w.quantity} шт
                      {w.price != null ? ` · ${(w.price * w.quantity).toLocaleString("ru")} ₽` : ""}
                    </span>
                    {wsEditable ? (
                      <button
                        type="button"
                        disabled={wsBusy}
                        onClick={() => void removeWorkItem(w.id)}
                        aria-label="Удалить работу"
                        className="p-1 text-neutral-400 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-neutral-500">Пока пусто. Добавьте выполненные работы.</p>
            )}

            {wsEditable ? (
              <div className="mt-3 flex flex-col gap-2">
                <select
                  data-testid="worksheet-select"
                  value={workSel}
                  onChange={(e) => setWorkSel(e.target.value)}
                  className="h-11 rounded-lg border border-neutral-300 px-3 text-base outline-none focus:border-neutral-900"
                >
                  <option value="">Своя работа (вписать)…</option>
                  {groupCatalog(workCatalog).map((g, gi) =>
                    g.name ? (
                      <optgroup key={gi} label={g.name}>
                        {g.items.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      g.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    ),
                  )}
                </select>
                {!workSel ? (
                  <input
                    value={workFree}
                    onChange={(e) => setWorkFree(e.target.value)}
                    placeholder="Название работы"
                    className="h-11 rounded-lg border border-neutral-300 px-3 text-base outline-none focus:border-neutral-900"
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-500">Кол-во</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={workQty}
                    onChange={(e) => setWorkQty(e.target.value)}
                    className="h-11 w-20 rounded-lg border border-neutral-300 px-3 text-base outline-none"
                  />
                  <button
                    type="button"
                    disabled={wsBusy || (!workSel && !workFree.trim())}
                    onClick={() => void addWorkItem()}
                    className="h-11 flex-1 rounded-lg border border-neutral-300 text-base font-medium text-neutral-800 disabled:opacity-50"
                  >
                    Добавить
                  </button>
                </div>
                <button
                  type="button"
                  disabled={wsBusy || t.workItems.length === 0}
                  onClick={() => void submitWorksheet()}
                  className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-lg bg-indigo-600 text-base font-semibold text-white active:bg-indigo-700 disabled:opacity-50"
                >
                  Отправить на расценку
                </button>
              </div>
            ) : ws === "PRICING" ? (
              <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                Отправлено на расценку — ждём цены от диспетчера.
              </p>
            ) : ws === "PRICED" ? (
              <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                Цены проставлены. Итог: {worksheetTotal.toLocaleString("ru")} ₽
              </p>
            ) : ws === "SIGNED" ? (
              <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                Итог: {worksheetTotal.toLocaleString("ru")} ₽ · акт приложен ✓
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Подписанный акт — ремонтно-арендные типы (Фаза 1.5). Не блокирует завершение. */}
        {requiresSignedDoc ? (
          <section className="rounded-xl border border-neutral-200 p-3">
            <p className="text-xs uppercase tracking-wide text-neutral-400">Подписанный акт</p>
            {docs.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {docs.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <a
                      href={`/api/attachments/${a.id}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-2 text-sm font-medium text-blue-700 underline"
                    >
                      <FileText className="h-4 w-4" /> Акт {a.mimeType === "application/pdf" ? "(PDF)" : "(фото)"}
                    </a>
                    {t.status !== "DONE" ? (
                      <button
                        type="button"
                        disabled={photoBusy}
                        onClick={() => void removePhoto(a.id)}
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
              <p className="mt-1 text-sm text-neutral-500">
                Не приложен. Без акта — отметка KPI, но завершить задачу можно.
              </p>
            )}
            <button
              type="button"
              disabled={photoBusy}
              onClick={() => docRef.current?.click()}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 text-base font-medium text-neutral-800 disabled:opacity-50"
            >
              {photoBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
              Приложить акт
            </button>
            {pendingDocs > 0 ? (
              <p className="mt-2 text-sm text-amber-700">Акт в очереди — уйдёт при связи</p>
            ) : null}
          </section>
        ) : null}

        {/* Причина паузы / отмены */}
        {t.status === "ON_HOLD" && t.holdReason ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            На паузе: {t.holdReason}
          </p>
        ) : null}
        {t.status === "CANCELLED" && t.cancelReason ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            Отменена: {t.cancelReason}
          </p>
        ) : null}

        {/* История */}
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-400">История</p>
          <ol className="space-y-1.5 border-l-2 border-neutral-200 pl-3">
            {t.events.map((ev) => (
              <li key={ev.id} className="text-sm">
                <span className="text-neutral-400">{formatDateTime(ev.at)}</span>{" "}
                <span className="text-neutral-700">{KIND_LABEL[ev.kind] ?? ev.kind}</span>
                {ev.toStatus ? (
                  <span className="text-neutral-700"> → {STATUS_LABEL[ev.toStatus]}</span>
                ) : null}
                {ev.comment ? <span className="text-neutral-500"> · {ev.comment}</span> : null}
              </li>
            ))}
          </ol>
        </section>

        {/* Комментарий */}
        <section className="flex flex-col gap-2">
          <textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий диспетчеру…"
            className="w-full rounded-lg border border-neutral-300 p-3 text-base outline-none focus:border-neutral-900"
          />
          <button
            type="button"
            disabled={busy || !comment.trim()}
            onClick={() => void sendComment()}
            className="inline-flex h-12 items-center justify-center rounded-lg border border-neutral-300 text-base font-medium text-neutral-800 disabled:opacity-50"
          >
            Отправить комментарий
          </button>
        </section>
      </div>

      {/* Нижняя зона — большая кнопка следующего статуса (зона большого пальца) */}
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t border-neutral-200 bg-white/95 p-3 backdrop-blur">
        {actionError ? <p className="mb-2 text-center text-sm text-red-600">{actionError}</p> : null}
        {pendingCount > 0 ? (
          <p className="mb-2 text-center text-sm font-medium text-amber-700">
            Не отправлено: {pendingCount} — уйдёт при связи
          </p>
        ) : null}
        {conflict ? (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
            Действие не прошло: задачу изменил диспетчер. Обновите и повторите.
          </p>
        ) : null}

        {next ? (
          <>
            <button
              type="button"
              disabled={busy || blockedByActive || blockedNoShift}
              onClick={() => (next.to === "DONE" ? openCompletion() : void changeStatus(next.to))}
              className={`flex h-14 w-full items-center justify-center rounded-xl text-lg font-semibold text-white transition-colors disabled:opacity-60 ${next.cls}`}
            >
              {next.label} →
            </button>
            {blockedNoShift ? (
              <p className="mt-1 text-center text-sm text-amber-700">Сначала откройте смену</p>
            ) : blockedByActive ? (
              <p className="mt-1 text-center text-sm text-amber-700">
                Сначала завершите активную задачу №{activeOther?.number}
              </p>
            ) : null}
          </>
        ) : displayStatus === "DONE" ? (
          <p className="py-2 text-center text-base font-medium text-green-700">Задача выполнена ✓</p>
        ) : displayStatus === "CANCELLED" ? (
          <p className="py-2 text-center text-base text-neutral-500">Задача отменена</p>
        ) : null}

        {canHold ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setHoldOpen(true)}
            className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-medium text-amber-700 disabled:opacity-60"
          >
            Поставить на паузу
          </button>
        ) : null}
      </div>

      {/* Скрытый input камеры */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadPhotos(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Скрытый input акта: фото или PDF (без capture — можно выбрать файл) */}
      <input
        ref={docRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          void uploadDoc(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Экран завершения */}
      {completionOpen ? (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/40"
          onClick={() => !busy && setCompletionOpen(false)}
        >
          <div
            className="mx-auto max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-neutral-900">Завершение задачи</p>
              <button type="button" onClick={() => setCompletionOpen(false)} className="p-1 text-neutral-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Фото отчёта */}
            <p className="mt-3 text-sm font-medium text-neutral-700">Фото отчёта (по желанию)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {myPhotos.map((a) => (
                <div key={a.id} className="relative">
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt="фото отчёта"
                    className="h-24 w-24 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={() => void removePhoto(a.id)}
                    aria-label="Удалить фото"
                    className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
                className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-neutral-300 text-xs text-neutral-500 disabled:opacity-50"
              >
                {photoBusy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                {photoBusy ? "Загрузка…" : "Добавить"}
              </button>
            </div>

            {/* Оплата на месте (№8): получено / не получено + причина. Без оплаты завершить можно —
                но выбор обязателен, чтобы инфа не терялась (диспетчер увидит причину). */}
            {onSite ? (
              <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                <p className="text-base font-medium text-amber-900">Оплата на месте</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayChoice("paid")}
                    className={`h-11 rounded-lg border text-sm font-medium ${
                      payChoice === "paid"
                        ? "border-green-600 bg-green-600 text-white"
                        : "border-amber-300 bg-white text-amber-900"
                    }`}
                  >
                    Деньги получены
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayChoice("unpaid")}
                    className={`h-11 rounded-lg border text-sm font-medium ${
                      payChoice === "unpaid"
                        ? "border-red-500 bg-red-500 text-white"
                        : "border-amber-300 bg-white text-amber-900"
                    }`}
                  >
                    Не получены
                  </button>
                </div>
                {payChoice === "paid" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-amber-900">Сумма, ₽</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="h-11 w-32 rounded-lg border border-amber-300 bg-white px-3 text-base outline-none"
                    />
                  </div>
                ) : null}
                {payChoice === "unpaid" ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <span className="text-sm text-amber-900">Причина неоплаты</span>
                    <select
                      value={missReason}
                      onChange={(e) => setMissReason(e.target.value)}
                      className="h-11 rounded-lg border border-amber-300 bg-white px-3 text-base outline-none"
                    >
                      <option value="">— выберите —</option>
                      {UNPAID_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {missReason === "Другое" ? (
                      <input
                        type="text"
                        value={missOther}
                        onChange={(e) => setMissOther(e.target.value)}
                        placeholder="Опишите причину"
                        className="h-11 rounded-lg border border-amber-300 bg-white px-3 text-base outline-none"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Акт не приложен (акты до 20:00, 02.07): приложить сейчас или выбрать причину.
                Выбор обязателен, но завершение не блокирует — Милена увидит причину в нарушении. */}
            {actReasonNeeded ? (
              <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                <p className="text-base font-medium text-amber-900">Подписанный акт</p>
                <p className="mt-0.5 text-sm text-amber-800">
                  По задаче нужен акт, он не приложен. Приложите фото акта (до 20:00) или укажите
                  причину.
                </p>
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={() => docRef.current?.click()}
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white text-sm font-medium text-amber-900 disabled:opacity-50"
                >
                  <Camera className="h-5 w-5" />
                  Приложить акт сейчас
                </button>
                <div className="mt-2 flex flex-col gap-2">
                  {ACT_MISSED_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setActReasonChoice(r)}
                      className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-medium ${
                        actReasonChoice === r
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-amber-300 bg-white text-amber-900"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Комментарий */}
            <textarea
              rows={2}
              value={doneComment}
              onChange={(e) => setDoneComment(e.target.value)}
              placeholder="Комментарий (по желанию)…"
              className="mt-4 w-full rounded-lg border border-neutral-300 p-3 text-base outline-none focus:border-neutral-900"
            />

            {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}
            {pendingPhotos > 0 ? (
              <p className="mt-2 text-sm text-amber-700">+{pendingPhotos} фото в очереди — уйдут при связи</p>
            ) : null}

            <button
              type="button"
              disabled={busy || photoBusy || !canComplete}
              onClick={submitCompletion}
              className="mt-4 flex h-14 w-full items-center justify-center rounded-xl bg-green-600 text-lg font-semibold text-white active:bg-green-700 disabled:opacity-50"
            >
              Завершить
            </button>
          </div>
        </div>
      ) : null}

      {/* Модалка причины паузы */}
      {holdOpen ? (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={() => setHoldOpen(false)}>
          <div
            className="mx-auto w-full max-w-md rounded-t-2xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-semibold text-neutral-900">Почему ждём?</p>
            <p className="mt-0.5 text-sm text-neutral-500">
              Можно указать причину (нет пропуска, ждём запчасти, клиент недоступен) — или просто
              поставить на паузу.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина (по желанию)"
              className="mt-3 w-full rounded-lg border border-neutral-300 p-3 text-base outline-none focus:border-neutral-900"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setHoldOpen(false)}
                className="h-12 flex-1 rounded-lg border border-neutral-300 text-base font-medium text-neutral-700"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeStatus("ON_HOLD", { reason: reason.trim() || undefined })}
                className="h-12 flex-1 rounded-lg bg-amber-500 text-base font-semibold text-white disabled:opacity-50"
              >
                На паузу
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="text-base text-neutral-800">{children}</span>
    </div>
  );
}
