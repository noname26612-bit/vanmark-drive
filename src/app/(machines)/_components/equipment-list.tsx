"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/machines/photos/:id по сессионной
   куке; next/image ходит через свой прокси без куки и получил бы 404 (как у вложений задач). */

import Link from "next/link";
import { AlertTriangle, ImageOff, Package } from "lucide-react";
import { cn } from "@/lib/cn";
import { Highlighted } from "@/components/highlight";
import { machineDueState } from "@/domain/machine-flags";
import { isStockKind } from "@/domain/machine-status";
import { firstHiddenMachineMatch, type parseQuery } from "@/lib/machine-search";
import { MACHINE_STATUS_BAR, dueBadgeClass, formatDayShort, machineTitle } from "@/lib/machine-ui";
import type { EquipmentGroup } from "@/lib/equipment-view";
import type { MachineListItem } from "@/lib/machine-dto";
import {
  MachineCategoryBadge,
  MachineKindBadge,
  MachineStatusBadge,
} from "../machines/_components/machine-badges";

type Query = ReturnType<typeof parseQuery> | null;

/**
 * Список оборудования в двух видах (решение Артёма 15.08.2026): за компьютером — плотная таблица,
 * на телефоне — строки. Это не два разных списка, а одна разметка с двумя раскладками: данные,
 * ссылки и подсветка поиска общие, расходится только то, как они разложены.
 *
 * Заголовок строки — учётный «77-N»: сквозной системный номер из интерфейса убран совсем.
 */
export function EquipmentList({
  groups,
  query,
  basePath,
}: {
  groups: EquipmentGroup[];
  query: Query;
  basePath: string;
}) {
  return (
    <div data-testid="machine-list">
      {groups.map((group) => (
        <section key={group.key} className="mb-4 last:mb-0">
          {group.title ? (
            <h2 className="mb-1.5 px-1 text-xs font-medium text-neutral-500">
              {group.title} · {group.items.length}
            </h2>
          ) : null}

          {/* Телефон: строки-карточки, тач-цель во всю ширину. */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {group.items.map((m) => (
              <li key={m.id}>
                <EquipmentCard machine={m} query={query} basePath={basePath} />
              </li>
            ))}
          </ul>

          {/* Компьютер: таблица — за один взгляд видно два десятка станков. */}
          <div className="hidden overflow-x-auto rounded-lg border border-neutral-200 bg-white lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs text-neutral-400">
                <tr>
                  <th className="w-24 px-3 py-2 font-normal">Номер</th>
                  <th className="w-14 px-3 py-2 font-normal">Фото</th>
                  <th className="px-3 py-2 font-normal">Модель</th>
                  <th className="w-44 px-3 py-2 font-normal">Состояние</th>
                  <th className="w-36 px-3 py-2 font-normal">Место</th>
                  <th className="w-24 px-3 py-2 font-normal">Срок</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((m) => (
                  <EquipmentRow key={m.id} machine={m} query={query} basePath={basePath} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

/** Остаток складской позиции: «свободно 3 из 5». Именно свободное число решает, можно ли её обещать. */
function StockCount({ machine: m }: { machine: MachineListItem }) {
  const short = m.freeQuantity === m.quantity;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-sm",
        m.freeQuantity === 0 ? "text-amber-700" : "text-neutral-800",
      )}
      data-testid="stock-count"
    >
      <Package className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
      {short ? `${m.quantity} шт` : `${m.freeQuantity} из ${m.quantity} шт`}
    </span>
  );
}

/** Состав комплекта одной строкой: что уедет вместе с этим станком. */
function KitLine({ machine: m }: { machine: MachineListItem }) {
  if (m.kitParts.length === 0 && m.kitHeads.length === 0) return null;
  if (m.kitParts.length > 0) {
    const text = m.kitParts
      .map((p) => (p.ourNumber ? `77-${p.ourNumber}` : p.model) + (p.qty > 1 ? ` ×${p.qty}` : ""))
      .join(", ");
    return <span className="truncate text-xs text-neutral-500">Комплект: {text}</span>;
  }
  const heads = m.kitHeads
    .map((h) => (h.ourNumber ? `77-${h.ourNumber}` : h.model) + (h.qty > 1 ? ` ×${h.qty}` : ""))
    .join(", ");
  return <span className="truncate text-xs text-neutral-500">В комплекте: {heads}</span>;
}

function EquipmentRow({
  machine: m,
  query,
  basePath,
}: {
  machine: MachineListItem;
  query: Query;
  basePath: string;
}) {
  const stock = isStockKind(m.kind);
  const dueState = m.dueDate ? machineDueState(m, new Date()) : null;
  return (
    <tr className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
      <td className="px-3 py-2">
        <Link href={`${basePath}/${m.id}`} className="flex items-center gap-1.5 font-medium">
          {m.isUrgent ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="Срочный" />
          ) : null}
          <Highlighted text={machineTitle(m)} query={query} />
        </Link>
      </td>
      <td className="px-3 py-2">
        <Link href={`${basePath}/${m.id}`}>
          <Thumb machine={m} size="sm" />
        </Link>
      </td>
      <td className="px-3 py-2">
        <Link href={`${basePath}/${m.id}`} className="flex flex-col">
          <span className="truncate">
            <Highlighted text={m.model} query={query} />
            {m.metalThickness ? <span className="text-neutral-500"> · {m.metalThickness}</span> : null}
          </span>
          <KitLine machine={m} />
        </Link>
      </td>
      <td className="px-3 py-2">
        {stock ? (
          <StockCount machine={m} />
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <MachineStatusBadge status={m.status} />
            <MachineKindBadge kind={m.kind} />
            <MachineCategoryBadge category={m.category} />
          </span>
        )}
      </td>
      <td className="truncate px-3 py-2 text-neutral-600">
        {m.location ? <Highlighted text={m.location} query={query} /> : "—"}
      </td>
      <td className="px-3 py-2">
        {m.dueDate ? (
          <span
            className={cn("rounded px-1.5 py-0.5 text-xs font-medium", dueBadgeClass(dueState))}
            data-testid="machine-due-badge"
          >
            {dueState === "overdue"
              ? `просрочен ${formatDayShort(m.dueDate)}`
              : `до ${formatDayShort(m.dueDate)}`}
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </td>
    </tr>
  );
}

function Thumb({ machine: m, size }: { machine: MachineListItem; size: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-9" : "h-16 w-16";
  if (m.photoId) {
    return (
      <img
        src={`/api/machines/photos/${m.photoId}`}
        alt=""
        loading="lazy"
        className={cn(box, "shrink-0 rounded-lg border border-neutral-200 object-cover")}
      />
    );
  }
  return (
    <span
      className={cn(
        box,
        "flex shrink-0 items-center justify-center rounded-lg border border-dashed border-neutral-200 text-neutral-300",
      )}
    >
      <ImageOff className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </span>
  );
}

function EquipmentCard({
  machine: m,
  query,
  basePath,
}: {
  machine: MachineListItem;
  query: Query;
  basePath: string;
}) {
  const title = machineTitle(m);
  const stock = isStockKind(m.kind);
  // Заказчик виден прямо в строке — если совпало по нему, сниппет «почему нашлось» был бы дублем.
  const hidden = query?.active
    ? firstHiddenMachineMatch(m, query, [m.model, m.location ?? "", m.orgName ?? "", title])
    : null;
  // Красный — только просрочен, янтарный — только «≤2 дней»; спокойный срок (и аренда/архив) — серый.
  const dueState = m.dueDate ? machineDueState(m, new Date()) : null;

  return (
    <Link
      href={`${basePath}/${m.id}`}
      className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-neutral-200 bg-white active:bg-neutral-50"
    >
      <span className={cn("w-1 shrink-0", stock ? "bg-slate-200" : MACHINE_STATUS_BAR[m.status])} aria-hidden />

      <span className="my-2 flex">
        <Thumb machine={m} size="md" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1 py-2 pr-3">
        <span className="flex flex-wrap items-center gap-2">
          {m.isUrgent ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="Срочный" />
          ) : null}
          <span className="text-sm font-medium text-neutral-900">
            <Highlighted text={title} query={query} />
          </span>
          {stock ? (
            <StockCount machine={m} />
          ) : (
            <>
              <MachineStatusBadge status={m.status} />
              <MachineKindBadge kind={m.kind} />
              <MachineCategoryBadge category={m.category} />
              {m.dueDate ? (
                <span
                  className={cn("rounded px-1.5 py-0.5 text-xs font-medium", dueBadgeClass(dueState))}
                  data-testid="machine-due-badge"
                >
                  {dueState === "overdue"
                    ? `просрочен ${formatDayShort(m.dueDate)}`
                    : `до ${formatDayShort(m.dueDate)}`}
                </span>
              ) : null}
            </>
          )}
        </span>

        <span className="truncate text-sm text-neutral-800">
          <Highlighted text={m.model} query={query} />
          {m.metalThickness ? <span className="text-neutral-500"> · {m.metalThickness}</span> : null}
        </span>

        <span className="flex flex-wrap gap-x-3 text-xs text-neutral-500">
          {m.location ? (
            <span>
              Место: <Highlighted text={m.location} query={query} />
            </span>
          ) : null}
          {m.orgName ? (
            <span className="truncate">
              <Highlighted text={m.orgName} query={query} />
            </span>
          ) : null}
          {m.category === "CLIENT" && !m.invoice1C ? (
            <span className="text-amber-700">Без заказа 1С</span>
          ) : null}
          {m.photoCount > 1 ? <span>{m.photoCount} фото</span> : null}
        </span>

        <KitLine machine={m} />

        {hidden ? (
          <span className="text-xs text-neutral-500">
            {hidden.label}: <Highlighted text={hidden.text} query={query} phone={hidden.phone} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
