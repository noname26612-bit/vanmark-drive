"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/machines/photos/:id по сессионной
   куке; next/image ходит через свой прокси без куки и получил бы 404 (как у вложений задач). */

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { AlertTriangle, ImageOff, Package } from "lucide-react";
import { cn } from "@/lib/cn";
import { Highlighted } from "@/components/highlight";
import { machineDueState } from "@/domain/machine-flags";
import { isStockKind } from "@/domain/machine-status";
import { firstHiddenMachineMatch, type parseQuery } from "@/lib/machine-search";
import {
  MACHINE_STATUS_BAR,
  dueBadgeClass,
  formatDayShort,
  formatMachineNumber,
  machineTitle,
} from "@/lib/machine-ui";
import {
  EQUIPMENT_COLUMNS,
  colsSnapshot,
  parseCols,
  resetCol,
  saveColPair,
  visibleColWidths,
  MIN_COL_PCT,
  serverColsSnapshot,
  subscribeCols,
  type EquipmentColumnKey,
} from "@/lib/equipment-columns";
import type { EquipmentGroup } from "@/lib/equipment-view";
import type { MachineListItem } from "@/lib/machine-dto";
import type { EquipmentFamily } from "@/generated/prisma/enums";
import {
  MachineCategoryBadge,
  MachineKindBadge,
  MachineStatusBadge,
} from "../machines/_components/machine-badges";

type Query = ReturnType<typeof parseQuery> | null;

// Набор колонок задан Артёмом 20.08.2026: номер, фото, модель, состояние, цена, толщина металла и
// срок. «Заказчик» и «Место» ушли совсем — соответствующих полей у карточки больше нет.
const COLUMN_LABEL: Record<EquipmentColumnKey, string> = {
  number: "Номер",
  photo: "Фото",
  model: "Модель",
  status: "Состояние",
  price: "Цена",
  thickness: "Толщина металла",
  due: "Срок",
};

/** Тянущаяся граница: всё, что нужно посчитать новую ширину, снимается один раз на pointerdown. */
type Drag = {
  key: EquipmentColumnKey;
  /** Сосед справа: перетаскивание границы перекладывает проценты между этой парой. */
  nextKey: EquipmentColumnKey;
  startX: number;
  startPct: number;
  nextStartPct: number;
  /** Сумма процентов видимых колонок на момент захвата — множитель перевода пикселей в проценты. */
  totalShare: number;
  /** Ширина таблицы в пикселях — знаменатель перевода «сдвиг мыши → проценты». */
  tableWidth: number;
};

/**
 * Список оборудования в двух видах (решение Артёма 15.08.2026): за компьютером — плотная таблица,
 * на телефоне — строки. Это не два разных списка, а одна разметка с двумя раскладками: данные,
 * ссылки и подсветка поиска общие, расходится только то, как они разложены.
 *
 * Заголовок строки — учётный номер: «77-N» у своего парка, «К-N» у клиентского. Сквозной
 * системный номер из интерфейса убран совсем.
 *
 * Ширины колонок таблицы тянутся мышью и запоминаются на устройстве (Артём 20.08.2026: «нужно
 * добавить возможность регулировать ширину столбцов»). Хранит их equipment-columns, здесь — только
 * чтение снимка и перетаскивание границы.
 */
export function EquipmentList({
  groups,
  query,
  basePath,
  family,
}: {
  groups: EquipmentGroup[];
  query: Query;
  basePath: string;
  family: EquipmentFamily;
}) {
  // Колонка «Срок» появляется, только если срок кому-то проставлен: у своего парка его чаще нет
  // вовсе, и пустой столбец прочерков честнее отдать модели и состоянию.
  const showDue = groups.some((g) => g.items.some((m) => m.dueDate));
  const columns = useMemo(
    () => EQUIPMENT_COLUMNS.filter((key) => key !== "due" || showDue),
    [showDue],
  );

  // Ширины личные и лежат в localStorage. Читаем через useSyncExternalStore: на сервере снимок
  // «по умолчанию», на клиенте — сохранённый, и разметка при гидрации не расходится (React #418).
  const rawCols = useSyncExternalStore(
    subscribeCols,
    useCallback(() => colsSnapshot(family), [family]),
    serverColsSnapshot,
  );
  const widths = useMemo(() => parseCols(rawCols), [rawCols]);
  // Сумма сохранённых процентов ВИДИМЫХ колонок. Она равна 100 только когда показаны все семь:
  // без колонки «Срок» это 93, а после перетаскиваний — что угодно. Через неё переводим сдвиг мыши
  // в «сырые» проценты и ею же нормализуем доли для colgroup.
  const totalShare = useMemo(
    () => columns.reduce((sum, key) => sum + widths[key], 0),
    [columns, widths],
  );
  const shares = useMemo(() => visibleColWidths(widths, columns), [widths, columns]);

  // Тянущаяся колонка живёт в ref, а не в state: pointermove сыплется десятками в секунду, и
  // перерисовывать на каждый из них весь список нельзя. В state — только факт «тянем сейчас»,
  // он нужен один раз, чтобы погасить выделение текста.
  const drag = useRef<Drag | null>(null);
  const [resizing, setResizing] = useState(false);

  function startResize(key: EquipmentColumnKey, e: ReactPointerEvent<HTMLDivElement>) {
    const table = e.currentTarget.closest("table");
    const tableWidth = table?.getBoundingClientRect().width ?? 0;
    const next = columns[columns.indexOf(key) + 1];
    if (tableWidth === 0 || next === undefined) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Тянем границу МЕЖДУ двумя колонками: сколько забрали у правой, столько отдали левой.
    // Сумма долей не меняется, поэтому граница едет ровно за курсором (см. saveColPair).
    drag.current = {
      key,
      nextKey: next,
      startX: e.clientX,
      startPct: widths[key],
      nextStartPct: widths[next],
      totalShare,
      tableWidth,
    };
    setResizing(true);
  }

  function moveResize(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    // Кнопку отпустили мимо нас (жест прервали, узел перерисовался под курсором) — считаем жест
    // законченным. Без этого залипший drag начинал бы тянуть колонку от старой точки при простом
    // движении мыши над границей.
    if (e.buttons === 0) {
      endResize();
      return;
    }
    // Сдвиг переводим в «сырые» проценты через сумму видимых колонок: на экране колонка занимает
    // долю pct/totalShare, поэтому пиксели делим на ширину таблицы и умножаем на ту же сумму.
    // Без этого на экране без колонки «Срок» (сумма 93) граница отстаёт от курсора.
    const delta = ((e.clientX - d.startX) / d.tableWidth) * d.totalShare;
    const room = d.startPct + d.nextStartPct;
    // Упор в MIN с обеих сторон: колонку нельзя ни схлопнуть, ни выдавить соседа.
    const leftPct = Math.min(Math.max(d.startPct + delta, MIN_COL_PCT), room - MIN_COL_PCT);
    saveColPair(
      family,
      { key: d.key, pct: leftPct },
      { key: d.nextKey, pct: room - leftPct },
    );
  }

  function endResize() {
    if (!drag.current) return;
    drag.current = null;
    setResizing(false);
  }

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

          {/* Компьютер: таблица — за один взгляд видно два десятка станков.
              table-fixed с долями: без него единственная колонка без ширины («Модель») забирала
              весь остаток широкого монитора и между ней и состоянием зияла пустота.
              Ширины задаёт colgroup, а НЕ классы на th: заголовок повторяется в каждой группе, и
              общий источник ширин — единственный способ не дать группам разъехаться между собой. */}
          <div className="hidden overflow-x-auto rounded-lg border border-neutral-200 bg-white lg:block">
            <table
              className={cn("w-full table-fixed text-left text-sm", resizing && "select-none")}
            >
              <colgroup>
                {columns.map((key) => (
                  <col key={key} style={{ width: `${shares[key]}%` }} />
                ))}
              </colgroup>
              <thead className="border-b border-neutral-200 text-xs text-neutral-400">
                <tr>
                  {columns.map((key, i) => (
                    <th
                      key={key}
                      className="relative px-3 py-2 font-normal"
                      data-testid={`col-head-${key}`}
                    >
                      {COLUMN_LABEL[key]}
                      {/* У последней колонки границы справа нет — тянуть не за что. */}
                      {i < columns.length - 1 ? (
                        <div
                          aria-hidden
                          data-testid={`col-resize-${key}`}
                          onPointerDown={(e) => startResize(key, e)}
                          onPointerMove={moveResize}
                          onPointerUp={endResize}
                          onPointerCancel={endResize}
                          onLostPointerCapture={endResize}
                          onDoubleClick={() => resetCol(family, key, columns[i + 1])}
                          title="Потяните за границу; двойной щелчок вернёт ширину"
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-neutral-300"
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.items.map((m) => (
                  <EquipmentRow
                    key={m.id}
                    machine={m}
                    query={query}
                    basePath={basePath}
                    showDue={showDue}
                  />
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
      .map((p) => (formatMachineNumber(p) ?? p.model) + (p.qty > 1 ? ` ×${p.qty}` : ""))
      .join(", ");
    return <span className="truncate text-xs text-neutral-500">Комплект: {text}</span>;
  }
  const heads = m.kitHeads
    .map((h) => (formatMachineNumber(h) ?? h.model) + (h.qty > 1 ? ` ×${h.qty}` : ""))
    .join(", ");
  return <span className="truncate text-xs text-neutral-500">В комплекте: {heads}</span>;
}

/** Пустая ячейка: прочерк, а не пустота — иначе строка выглядит обрезанной. */
function Dash() {
  return <span className="text-neutral-400">—</span>;
}

/** Бейдж срока: красный — просрочен, янтарный — горит, спокойный (и аренда/архив) — графит. */
function DueBadge({ machine: m }: { machine: MachineListItem }) {
  if (!m.dueDate) return <Dash />;
  const state = machineDueState(m, new Date());
  return (
    <span
      className={cn("rounded px-1.5 py-0.5 text-xs font-medium", dueBadgeClass(state))}
      data-testid="machine-due-badge"
    >
      {state === "overdue" ? `просрочен ${formatDayShort(m.dueDate)}` : `до ${formatDayShort(m.dueDate)}`}
    </span>
  );
}

// Порядок ячеек обязан совпадать с EQUIPMENT_COLUMNS — по нему же размечен colgroup.
function EquipmentRow({
  machine: m,
  query,
  basePath,
  showDue,
}: {
  machine: MachineListItem;
  query: Query;
  basePath: string;
  showDue: boolean;
}) {
  const stock = isStockKind(m.kind);
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
        <Link href={`${basePath}/${m.id}`} className="flex min-w-0 flex-col">
          <span className="truncate">
            <Highlighted text={m.model} query={query} />
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
            <MachineCategoryBadge categories={m.categories} />
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-neutral-800">
        {m.price === null ? (
          <Dash />
        ) : (
          <span className="whitespace-nowrap tabular-nums">
            {m.price.toLocaleString("ru-RU")} ₽
          </span>
        )}
      </td>
      <td className="truncate px-3 py-2 text-neutral-600">
        {m.metalThickness ? <Highlighted text={m.metalThickness} query={query} /> : <Dash />}
      </td>
      {showDue ? (
        <td className="px-3 py-2">
          <DueBadge machine={m} />
        </td>
      ) : null}
    </tr>
  );
}

/** Миниатюра: по станку узнают в первую очередь по виду, поэтому фото крупное (Артём 15.08.2026). */
function Thumb({ machine: m, size }: { machine: MachineListItem; size: "sm" | "md" }) {
  const box = size === "sm" ? "h-14 w-14" : "h-20 w-20";
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
      <ImageOff className={size === "sm" ? "h-5 w-5" : "h-6 w-6"} />
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
  // Что видно в самой строке, то не нуждается в сниппете «почему нашлось».
  const hidden = query?.active
    ? firstHiddenMachineMatch(m, query, [m.model, m.metalThickness ?? "", title])
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
              <MachineCategoryBadge categories={m.categories} />
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

        {/* Цена и число фото — всё, что осталось от нижней строки: места и заказчика у карточки
            больше нет, а «Без заказа 1С» перестало быть индикатором 20.08.2026. */}
        <span className="flex flex-wrap gap-x-3 text-xs text-neutral-500">
          {m.price !== null ? <span>{m.price.toLocaleString("ru-RU")} ₽</span> : null}
          {m.photoCount > 1 ? <span>{m.photoCount} фото</span> : null}
        </span>

        <KitLine machine={m} />

        {hidden ? (
          <span className="text-xs text-neutral-500">
            {hidden.label}: <Highlighted text={hidden.text} query={query} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
