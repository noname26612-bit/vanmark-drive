"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Package, Plus, X } from "lucide-react";
import { apiSend, ApiError, fetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { newActionId as newIdempotencyKey } from "@/lib/offline/id";
import { isHeadKind, isStockKind } from "@/domain/machine-status";
import { EQUIPMENT_KIND_SHORT, MACHINE_STATUS_LABEL, formatMachineNumber } from "@/lib/machine-ui";
import type { MachineDetail } from "@/lib/machine-dto";
import type { EquipmentKind } from "@/generated/prisma/enums";

type Candidate = {
  id: string;
  ourNumber: number | null;
  clientNumber: number | null;
  kind: EquipmentKind;
  model: string;
  free: number;
};

/**
 * Комплект станка (решение Артёма 15.08.2026): «определённый нож идёт к определённому станку»,
 * размотчик и частотник — к своему фальцепрокатнику. Собранный комплект продаётся, сдаётся в аренду
 * и уходит в ремонт вместе с головным (переспрос — в StatusKitModal).
 *
 * У комплектующей блок показывает обратную сторону связи: в чьём она комплекте. Так, открыв нож,
 * сразу видно, что он не свободен, — не нужно искать это по всем станкам.
 */
export function KitPanel({
  machine,
  basePath,
  disabled,
  onChanged,
}: {
  machine: MachineDetail;
  basePath: string;
  disabled?: boolean;
  onChanged: (updated: MachineDetail) => void;
}) {
  const head = isHeadKind(machine.kind);
  const [adding, setAdding] = useState(false);
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ключ идемпотентности — один на попытку добавления: повтор после таймаута не должен списать
  // остаток дважды (урок офлайн-очереди, CLAUDE.md).
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const { data: candidates } = useSWR<Candidate[]>(
    head && adding ? `/api/machines/${machine.id}/kit` : null,
    fetcher,
  );

  const selected = candidates?.find((c) => c.id === partId) ?? null;
  const stockSelected = selected ? isStockKind(selected.kind) : false;

  async function attach() {
    if (!partId || busy) return;
    setBusy(true);
    setError(null);
    const key = idempotencyKey ?? newIdempotencyKey();
    if (!idempotencyKey) setIdempotencyKey(key);
    try {
      const updated = await apiSend<MachineDetail>(
        `/api/machines/${machine.id}/kit`,
        "POST",
        { partId, qty: stockSelected ? Number(qty) || 1 : 1 },
        { "Idempotency-Key": key },
      );
      setIdempotencyKey(null);
      setAdding(false);
      setPartId("");
      setQty("1");
      onChanged(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось добавить в комплект");
    } finally {
      setBusy(false);
    }
  }

  async function detach(id: string, label: string) {
    if (busy) return;
    if (!window.confirm(`Убрать ${label} из комплекта?`)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiSend<MachineDetail>(
        `/api/machines/${machine.id}/kit/${id}`,
        "DELETE",
      );
      onChanged(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось убрать из комплекта");
    } finally {
      setBusy(false);
    }
  }

  // Комплектующая: показываем, в чьём она комплекте. Добавлять отсюда нечего — комплект собирают
  // со стороны станка, чтобы у связи было одно очевидное место.
  if (!head) {
    if (machine.kitHeads.length === 0) return null;
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium text-neutral-700">В комплекте</h2>
        <ul className="flex flex-col gap-1 text-sm" data-testid="kit-heads">
          {machine.kitHeads.map((h) => (
            <li key={h.id}>
              <Link href={`${basePath}/${h.id}`} className="text-neutral-800 underline underline-offset-2">
                {formatMachineNumber(h) ? `${formatMachineNumber(h)} · ` : ""}
                {h.model}
              </Link>
              {h.qty > 1 ? <span className="text-neutral-500"> — {h.qty} шт</span> : null}
            </li>
          ))}
        </ul>
        {isStockKind(machine.kind) ? (
          <p className="text-xs text-neutral-500">
            Свободно {machine.freeQuantity} из {machine.quantity} шт.
          </p>
        ) : null}
      </section>
    );
  }

  const parts = machine.kitParts;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-700">Комплект</h2>
        {!adding ? (
          <Button
            variant="secondary"
            disabled={disabled || busy}
            onClick={() => setAdding(true)}
            data-testid="kit-add-open"
          >
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {parts.length === 0 && !adding ? (
        <p className="text-sm text-neutral-500">
          Пусто. Добавьте то, что уезжает вместе со станком, — оно будет продаваться, сдаваться в
          аренду и уходить в ремонт вместе с ним.
        </p>
      ) : null}

      {parts.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-sm" data-testid="kit-parts">
          {parts.map((p) => {
            const label = formatMachineNumber(p) ?? p.model;
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2"
              >
                <Link href={`${basePath}/${p.id}`} className="min-w-0 flex-1 truncate">
                  <span className="text-neutral-900">{label}</span>
                  <span className="text-neutral-500"> · {p.model}</span>
                </Link>
                <span className="shrink-0 text-xs text-neutral-500">
                  {isStockKind(p.kind) ? (
                    <span className="inline-flex items-center gap-1">
                      <Package className="h-3.5 w-3.5" aria-hidden />
                      {p.qty} шт
                    </span>
                  ) : (
                    `${EQUIPMENT_KIND_SHORT[p.kind]} · ${MACHINE_STATUS_LABEL[p.status]}`
                  )}
                </span>
                {p.consumedAt ? (
                  <span className="shrink-0 text-xs text-neutral-400">списано</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => detach(p.id, label)}
                    disabled={disabled || busy}
                    aria-label={`Убрать ${label} из комплекта`}
                    className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    data-testid="kit-detach"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {adding ? (
        <div className="flex flex-col gap-2">
          <Select
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            disabled={busy}
            data-testid="kit-part-select"
          >
            <option value="">Выберите комплектующую…</option>
            {(candidates ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {formatMachineNumber(c) ? `${formatMachineNumber(c)} · ` : ""}
                {c.model}
                {isStockKind(c.kind) ? ` — свободно ${c.free} шт` : ""}
              </option>
            ))}
          </Select>
          {candidates && candidates.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Свободных комплектующих нет — заведите их в этом же разделе.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {stockSelected ? (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={selected?.free}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-24 shrink-0"
                aria-label="Количество"
                data-testid="kit-qty"
              />
            ) : null}
            <Button onClick={attach} disabled={!partId || busy} data-testid="kit-attach">
              Добавить
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setPartId("");
                setError(null);
              }}
              disabled={busy}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
