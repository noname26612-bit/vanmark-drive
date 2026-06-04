"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Phone, Navigation, Loader2 } from "lucide-react";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { sendWithRetry } from "@/lib/retry";
import { getPositionOnce } from "@/lib/geo";
import type { TaskDetailDTO } from "@/lib/task-dto";
import type { TaskStatus } from "@/generated/prisma/enums";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  PASS_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  navUrl,
} from "@/lib/task-ui";
import { TypeIcon } from "@/components/type-icon";
import { Badge } from "@/components/ui/badge";

// Следующий статус по «водительской» цепочке. Это лишь подсказка для UI — сервер всё равно
// проверяет переход по матрице (src/domain/task-status.ts); в обход матрицы попасть нельзя.
const NEXT: Partial<Record<TaskStatus, { to: TaskStatus; label: string; cls: string }>> = {
  ASSIGNED: { to: "ACCEPTED", label: "Принял", cls: "bg-indigo-600 active:bg-indigo-700" },
  ACCEPTED: { to: "EN_ROUTE", label: "Выехал", cls: "bg-blue-600 active:bg-blue-700" },
  EN_ROUTE: { to: "ON_SITE", label: "На месте", cls: "bg-orange-500 active:bg-orange-600" },
  ON_SITE: { to: "DONE", label: "Выполнено", cls: "bg-green-600 active:bg-green-700" },
};

// «Ждёт» водитель может поставить только из этих статусов (матрица, В*: с обязательной причиной).
const CAN_HOLD: TaskStatus[] = ["ACCEPTED", "EN_ROUTE", "ON_SITE"];

const KIND_LABEL: Record<string, string> = {
  created: "Создана",
  status_change: "Статус",
  assign: "Назначение",
  edit: "Изменение",
  reschedule: "Перенос",
  comment: "Комментарий",
};

export function DriverTaskClient({ taskId }: { taskId: string }) {
  const key = `/api/tasks/${taskId}`;
  const { data: task, error, isLoading, mutate } = useSWR<TaskDetailDTO>(key, fetcher, {
    refreshInterval: 10_000,
  });

  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  if (isLoading) return <p className="p-6 text-base text-neutral-400">Загрузка…</p>;
  if (error || !task) {
    return (
      <div className="p-6">
        <p className="text-base text-red-600">Задача недоступна.</p>
        <Link href="/m" className="mt-2 inline-block text-base text-neutral-600 underline">
          ← Мои задачи
        </Link>
      </div>
    );
  }
  const t = task; // зафиксировали для замыканий ниже

  async function changeStatus(to: TaskStatus, holdReason?: string) {
    setActionError(null);
    setBusy(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await mutate(
        (async (): Promise<TaskDetailDTO | undefined> => {
          // Гео-метка best-effort: запрашиваем координаты в момент действия, не блокируем смену статуса.
          const coords = await getPositionOnce();
          await sendWithRetry(
            () =>
              apiSend(`${key}/transition`, "POST", {
                toStatus: to,
                reason: holdReason,
                lat: coords?.lat,
                lng: coords?.lng,
              }),
            { onRetry: () => setRetrying(true), signal: ac.signal },
          );
          setRetrying(false);
          return undefined; // populateCache:false — значение не используется, ревалидация ниже
        })(),
        {
          // Оптимистично показываем новый статус сразу (применяется синхронно до сети).
          optimisticData: (cur?: TaskDetailDTO) => ({ ...(cur ?? t), status: to }),
          rollbackOnError: true,
          revalidate: true,
          populateCache: false,
        },
      );
      setHoldOpen(false);
      setReason("");
    } catch (e) {
      setRetrying(false);
      if ((e as Error)?.name === "AbortError") return; // действие вытеснено новым — молча
      setActionError(e instanceof ApiError ? e.message : "Не удалось сменить статус");
    } finally {
      setBusy(false);
    }
  }

  async function sendComment() {
    const text = comment.trim();
    if (!text) return;
    setActionError(null);
    setBusy(true);
    try {
      await sendWithRetry(() => apiSend(`${key}/comments`, "POST", { text }), {
        onRetry: () => setRetrying(true),
      });
      setRetrying(false);
      setComment("");
      await mutate();
    } catch (e) {
      setRetrying(false);
      setActionError(e instanceof ApiError ? e.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  }

  const next = NEXT[t.status];
  const canHold = CAN_HOLD.includes(t.status);

  return (
    <div className="pb-44">
      {/* Шапка */}
      <div className="border-b border-neutral-100 px-4 py-3">
        <Link href="/m" className="text-sm text-neutral-500">
          ← Мои задачи
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-medium text-neutral-500">
            <TypeIcon name={t.type.icon} className="h-5 w-5" />
            №{t.number}
            {t.priority ? (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                Срочно
              </span>
            ) : null}
          </span>
          <Badge className={`text-sm ${STATUS_BADGE[t.status]}`}>{STATUS_LABEL[t.status]}</Badge>
        </div>
        <h1 className="mt-1 text-xl font-bold leading-snug text-neutral-900">{t.title}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">{t.type.name}</p>
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
        {t.paymentType === "ON_SITE" ? (
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
            onClick={sendComment}
            className="inline-flex h-12 items-center justify-center rounded-lg border border-neutral-300 text-base font-medium text-neutral-800 disabled:opacity-50"
          >
            Отправить комментарий
          </button>
        </section>
      </div>

      {/* Нижняя зона — большая кнопка следующего статуса (зона большого пальца) */}
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t border-neutral-200 bg-white/95 p-3 backdrop-blur">
        {retrying ? (
          <p className="mb-2 flex items-center justify-center gap-2 text-sm font-medium text-amber-700">
            <Loader2 className="h-4 w-4 animate-spin" /> Не отправлено, повторяю…
          </p>
        ) : null}
        {actionError ? (
          <p className="mb-2 text-center text-sm text-red-600">{actionError}</p>
        ) : null}

        {next ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => changeStatus(next.to)}
            className={`flex h-14 w-full items-center justify-center rounded-xl text-lg font-semibold text-white transition-colors disabled:opacity-60 ${next.cls}`}
          >
            {next.label} →
          </button>
        ) : t.status === "ON_HOLD" ? (
          <p className="py-2 text-center text-base text-neutral-500">На паузе — снимет диспетчер</p>
        ) : t.status === "DONE" ? (
          <p className="py-2 text-center text-base font-medium text-green-700">Задача выполнена ✓</p>
        ) : t.status === "CANCELLED" ? (
          <p className="py-2 text-center text-base text-neutral-500">Задача отменена</p>
        ) : null}

        {canHold ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setHoldOpen(true)}
            className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-medium text-amber-700 disabled:opacity-60"
          >
            Поставить на паузу («Ждёт»)
          </button>
        ) : null}
      </div>

      {/* Модалка причины паузы */}
      {holdOpen ? (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/40"
          onClick={() => setHoldOpen(false)}
        >
          <div
            className="mx-auto w-full max-w-md rounded-t-2xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-semibold text-neutral-900">Почему ждём?</p>
            <p className="mt-0.5 text-sm text-neutral-500">
              Например: нет пропуска, ждём запчасти, клиент недоступен.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина"
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
                disabled={busy || !reason.trim()}
                onClick={() => changeStatus("ON_HOLD", reason.trim())}
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
