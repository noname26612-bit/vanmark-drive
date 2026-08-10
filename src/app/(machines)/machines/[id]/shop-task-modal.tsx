"use client";

// «Задание в цех» (PRD §16.6): живой предпросмотр текста, собранного из карточки (дефектовка не
// дублируется — единственный источник buildShopTaskText, тот же, что пишет сервер), поле «что
// сделать», перевод в «В ремонте» одной галочкой. Цех вне системы: Максим отправляет текст в
// Telegram-группу «Задания в цех» сам — «Поделиться» на телефоне открывает системный шит,
// «Скопировать» работает везде. Факт и полный текст задания фиксируются в журнале станка.
import { useMemo, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { apiSend, ApiError } from "@/lib/fetcher";
import { newActionId as newIdempotencyKey } from "@/lib/offline/id";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { buildShopTaskText } from "@/lib/machine-shop-task";
import { canNativeShare, copyText, shareText } from "@/lib/clipboard";
import { isArchivedStatus } from "@/domain/machine-status";
import type { MachineDetail } from "@/lib/machine-dto";

export function ShopTaskModal({
  machine,
  onClose,
  onDone,
}: {
  machine: MachineDetail;
  onClose: () => void;
  /** Обновлённая карточка после записи в журнал. */
  onDone: (updated: MachineDetail) => void;
}) {
  const [note, setNote] = useState("");
  // Галочка перевода: скрыта, когда переводить некуда (уже в ремонте) или станок в архиве —
  // возврат из архива должен быть осознанным действием через селект состояния, не сайд-эффектом.
  const showRepairToggle = machine.status !== "IN_REPAIR" && !isArchivedStatus(machine.status);
  const [toInRepair, setToInRepair] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Текст уже у Максима (скопирован/отправлен), но запись в журнал упала — предлагаем дописать.
  const [retryOnly, setRetryOnly] = useState(false);
  // Ключ идемпотентности — ОДИН на открытие модалки (правило CLAUDE.md): повтор после таймаута
  // не создаёт второе событие. Модалка монтируется на каждое открытие заново — ключ свежий.
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const text = useMemo(() => buildShopTaskText(machine, note), [machine, note]);

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const updated = await apiSend<MachineDetail>(
        `/api/machines/${machine.id}/shop-task`,
        "POST",
        { note, toInRepair: showRepairToggle && toInRepair },
        { "Idempotency-Key": idempotencyKey },
      );
      onDone(updated);
      onClose();
    } catch (e) {
      setRetryOnly(true);
      setError(
        e instanceof ApiError
          ? e.message
          : "Текст готов, но задание не записалось в журнал. Нажмите «Записать ещё раз».",
      );
    } finally {
      setBusy(false);
    }
  }

  // Share/copy — синхронно в жесте клика (transient activation), запись в журнал — после.
  async function send(mode: "share" | "copy") {
    if (busy) return;
    setError(null);
    if (mode === "share") {
      const res = await shareText(text);
      if (res === "cancelled") return; // передумал в системном шите — события не пишем
      if (res === "failed") {
        setError("Не удалось поделиться. Попробуйте «Скопировать».");
        return;
      }
    } else {
      const ok = await copyText(text);
      if (!ok) {
        setError("Не удалось скопировать автоматически — выделите текст выше вручную.");
        return;
      }
    }
    await record();
  }

  return (
    <Modal open onClose={onClose} title="Задание в цех" wide>
      <div className="flex flex-col gap-3">
        <Field label="Что сделать / комментарий для цеха">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setRetryOnly(false);
            }}
            placeholder="Например: заменить подшипник, отрегулировать прижим"
            data-testid="shop-task-note"
          />
        </Field>

        <Field label="Текст задания (уйдёт в Telegram-группу цеха)">
          {/* readonly-textarea вместо <pre>: текст можно выделить и скопировать руками, если
              автокопирование недоступно (например, dev по LAN-IP без https). */}
          <Textarea
            readOnly
            value={text}
            rows={Math.min(10, text.split("\n").length + 1)}
            className="bg-neutral-50 text-sm"
            data-testid="shop-task-preview"
          />
        </Field>

        {showRepairToggle ? (
          <label className="flex min-h-12 items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={toInRepair}
              onChange={(e) => setToInRepair(e.target.checked)}
              className="h-4 w-4"
              data-testid="shop-task-to-repair"
            />
            Перевести станок в «В ремонте»
          </label>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          {retryOnly ? (
            <Button onClick={record} disabled={busy} data-testid="shop-task-retry">
              Записать ещё раз
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => send("copy")}
                disabled={busy}
                data-testid="shop-task-copy"
              >
                <Copy className="h-4 w-4" /> Скопировать
              </Button>
              {canNativeShare() ? (
                <Button onClick={() => send("share")} disabled={busy} data-testid="shop-task-share">
                  <Share2 className="h-4 w-4" /> Поделиться
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
