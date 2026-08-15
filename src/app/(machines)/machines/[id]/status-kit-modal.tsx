"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { isStockKind } from "@/domain/machine-status";
import { MACHINE_STATUS_LABEL } from "@/lib/machine-ui";
import type { KitPartView } from "@/lib/machine-dto";
import type { MachineStatus } from "@/generated/prisma/enums";

/**
 * Переспрос при смене состояния станка, у которого собран комплект (решение Артёма 15.08.2026:
 * «спросить, галочка уже стоит»). Комплект продаётся, сдаётся в аренду и уходит в ремонт вместе с
 * головным — но человек должен это видеть и иметь возможность снять галочку, если нож остаётся.
 *
 * Складские позиции в списке подписаны количеством: при продаже они СПИСЫВАЮТСЯ со склада, и это
 * необратимо — такое не показывают мелким шрифтом.
 */
export function StatusKitModal({
  open,
  status,
  parts,
  consumes,
  reasonRequired,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  status: MachineStatus | null;
  parts: KitPartView[];
  consumes: boolean;
  reasonRequired: boolean;
  onCancel: () => void;
  onConfirm: (opts: { withKit: boolean; reason: string | null }) => void;
}) {
  const [withKit, setWithKit] = useState(true);
  const [reason, setReason] = useState("");

  // Сброс при каждом открытии — «adjust state on prop change», как в форме заведения.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setWithKit(true);
      setReason("");
    }
  }

  if (!status) return null;
  const label = MACHINE_STATUS_LABEL[status];

  return (
    <Modal open={open} onClose={onCancel} title={`Перевести в «${label}»`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-600">В комплекте с этим станком:</p>
        <ul className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          {parts.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-neutral-800">
                {p.ourNumber ? `77-${p.ourNumber} · ` : ""}
                {p.model}
              </span>
              <span className="shrink-0 text-neutral-500">
                {isStockKind(p.kind) ? `${p.qty} шт` : MACHINE_STATUS_LABEL[p.status]}
              </span>
            </li>
          ))}
        </ul>

        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={withKit}
            onChange={(e) => setWithKit(e.target.checked)}
            className="mt-0.5 h-4 w-4"
            data-testid="kit-transfer-checkbox"
          />
          <span>
            Перевести вместе с комплектом
            {consumes ? (
              <span className="block text-xs text-amber-700">
                Складские позиции спишутся со склада — вернуть можно только правкой остатка.
              </span>
            ) : null}
          </span>
        </label>

        {reasonRequired ? (
          <Field label="Причина" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="например: дубль карточки 77-5"
              data-testid="kit-status-reason"
            />
          </Field>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            onClick={() => onConfirm({ withKit, reason: reason.trim() || null })}
            disabled={reasonRequired && !reason.trim()}
            data-testid="kit-status-confirm"
          >
            Перевести
          </Button>
        </div>
      </div>
    </Modal>
  );
}
