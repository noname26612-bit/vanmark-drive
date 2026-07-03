"use client";
// Разбор «непрошедших» офлайн-действий (O8). Действие, отклонённое сервером при досылке (диспетчер
// изменил задачу, переход уже невозможен, потеряно фото), помечается «конфликт» и остаётся в очереди.
// Раньше оно висело там вечно и молча искажало UI. Теперь водитель видит баннер «Не прошло: N —
// разобрать», открывает список с причинами и убирает каждое (решение Артёма 02.07 — только «Убрать»:
// нужное действие проще выполнить заново обычным способом). Отдельно — баннер «сессия истекла»
// (401/403 при досылке): очередь цела, после входа досошлётся сама.
import { useState } from "react";
import Link from "next/link";
import { usePendingActions, useAuthRequired } from "@/lib/offline/use-queue";
import { discardAction } from "@/lib/offline/queue";
import type { QueuedAction } from "@/lib/offline/types";

// Человекочитаемое имя действия — по виду (kind) и полезной нагрузке.
function actionLabel(a: QueuedAction): string {
  switch (a.kind) {
    case "transition": {
      const to = (a.bodyJson as { toStatus?: string } | undefined)?.toStatus;
      const map: Record<string, string> = {
        IN_PROGRESS: "Взятие в работу",
        DONE: "Завершение задачи",
        ON_HOLD: "Пауза",
        ASSIGNED: "Возврат в работу",
      };
      return (to && map[to]) || "Изменение статуса задачи";
    }
    case "comment":
      return "Комментарий";
    case "attachment":
      return a.blobMeta?.kind === "DOCUMENT" ? "Акт (документ)" : "Фото отчёта";
    case "attachment-delete":
      return "Удаление вложения";
    case "work-item-add":
      return "Добавление работы в ведомость";
    case "work-item-delete":
      return "Удаление работы из ведомости";
    case "worksheet-submit":
      return "Отправка ведомости на расценку";
    case "shift": {
      const op = (a.bodyJson as { op?: string } | undefined)?.op;
      const map: Record<string, string> = {
        open: "Открытие смены",
        close: "Закрытие смены",
        reopen: "Возобновление смены",
      };
      return (op && map[op]) || "Смена";
    }
    default:
      return "Действие";
  }
}

// «дд.мм чч:мм» из ISO в местной зоне (когда действие было выполнено на телефоне).
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ConflictCenter() {
  const actions = usePendingActions();
  const authRequired = useAuthRequired();
  const conflicts = actions.filter((a) => a.status === "conflict");
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await discardAction(id);
    } finally {
      setBusyId(null);
    }
  }

  if (conflicts.length === 0 && !authRequired) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {authRequired ? (
        <div
          data-testid="auth-required-banner"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        >
          Сессия истекла — войдите заново. Неотправленное сохранено и уйдёт после входа.
          <Link href="/login" className="ml-1 font-semibold underline">
            Войти
          </Link>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <button
          type="button"
          data-testid="conflict-banner"
          onClick={() => setOpen(true)}
          className="flex items-center justify-between rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-left text-sm font-medium text-red-800 active:bg-red-100"
        >
          <span>
            Не прошло{conflicts.length > 1 ? `: ${conflicts.length}` : ""} — разобрать
          </span>
          <span aria-hidden>›</span>
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setOpen(false)}>
          <div
            data-testid="conflict-sheet"
            className="mx-auto w-full max-w-md rounded-t-2xl bg-white p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900">Непрошедшие действия</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-neutral-500 underline">
                Закрыть
              </button>
            </div>
            <p className="mb-3 text-sm text-neutral-500">
              Сервер отклонил эти действия. Прочитайте причину, уберите — и при необходимости выполните
              заново обычным способом.
            </p>
            <ul className="flex flex-col gap-2">
              {conflicts.map((a) => (
                <li key={a.id} className="rounded-xl border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900">{actionLabel(a)}</p>
                      <p className="mt-0.5 text-sm text-red-700">{a.lastError?.message ?? "Не удалось отправить"}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">{whenLabel(a.createdAt)}</p>
                    </div>
                    <button
                      type="button"
                      data-testid="conflict-discard"
                      disabled={busyId === a.id}
                      onClick={() => void remove(a.id)}
                      className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 active:bg-neutral-100 disabled:opacity-50"
                    >
                      Убрать
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
