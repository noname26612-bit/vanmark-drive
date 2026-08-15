// Вид списка оборудования: группировка и направление (решение Артёма 15.08.2026 — «нужна
// возможность вариаций группировки списка и вариаций изменения порядка»).
//
// Настройка ЛИЧНАЯ и привязана к устройству: за компьютером удобна одна раскладка, на телефоне
// другая, поэтому храним в localStorage, а не в UiPreference (та синхронизируется между
// устройствами и предназначена для раскладки доски).
//
// Сам порядок карточек серверный и стабильный — по учётному номеру (machine-service). Здесь
// только представление: как разложить уже упорядоченный список.
import type { MachineListItem } from "./machine-dto";
import { EQUIPMENT_KIND_PLURAL, MACHINE_CATEGORY_LABEL, MACHINE_STATUS_LABEL } from "./machine-ui";

export type GroupBy = "none" | "status" | "category" | "kind";
export type Direction = "asc" | "desc";
export type EquipmentView = { groupBy: GroupBy; direction: Direction };

export const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "none", label: "Без групп" },
  { key: "status", label: "По состоянию" },
  { key: "category", label: "По категории" },
  { key: "kind", label: "По виду" },
];

export const DEFAULT_VIEW: EquipmentView = { groupBy: "none", direction: "asc" };

const STORAGE_PREFIX = "vanmark:equipment-view:v1:";
const DEFAULT_RAW = JSON.stringify(DEFAULT_VIEW);

// Настройка читается через useSyncExternalStore: на сервере снимок всегда «по умолчанию», на
// клиенте — из localStorage. Так гидрация не расходится (урок React #418) и не нужен setState в
// эффекте. Подписчики — открытые экраны: сохранил вид, все перерисовались.
const listeners = new Set<() => void>();

export function subscribeView(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Сырой снимок настройки. Возвращает именно СТРОКУ, а не объект: useSyncExternalStore сравнивает
 * снимки по ссылке, и новый объект на каждый вызов дал бы бесконечную перерисовку.
 */
export function viewSnapshot(family: string): string {
  if (typeof window === "undefined") return DEFAULT_RAW;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + family) ?? DEFAULT_RAW;
  } catch {
    // Недоступный localStorage (приватный режим) не должен ронять экран — вид по умолчанию.
    return DEFAULT_RAW;
  }
}

export function serverViewSnapshot(): string {
  return DEFAULT_RAW;
}

/** Разбор снимка с санитизацией: в хранилище могло остаться что угодно от прошлых версий. */
export function parseView(raw: string): EquipmentView {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_VIEW;
    const { groupBy, direction } = parsed as Partial<EquipmentView>;
    return {
      groupBy: GROUP_OPTIONS.some((o) => o.key === groupBy) ? (groupBy as GroupBy) : "none",
      direction: direction === "desc" ? "desc" : "asc",
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveView(family: string, view: EquipmentView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + family, JSON.stringify(view));
  } catch {
    // Настройка вида — не данные: не сохранилась, значит в следующий раз откроется по умолчанию.
  }
  for (const l of listeners) l();
}

export type EquipmentGroup = { key: string; title: string | null; items: MachineListItem[] };

// Порядок групп — жизненный цикл, а не алфавит: сначала то, чем занимаются, потом остальное.
const STATUS_ORDER = ["NEEDS_REPAIR", "IN_REPAIR", "ACCEPTED", "READY", "RENTED"] as const;
const CATEGORY_ORDER = ["CLIENT", "OUR_SALE", "OUR_RENTAL"] as const;

function groupKeyOf(item: MachineListItem, groupBy: GroupBy): string {
  if (groupBy === "status") return item.status;
  if (groupBy === "category") return item.category;
  if (groupBy === "kind") return item.kind;
  return "";
}

function groupTitleOf(key: string, groupBy: GroupBy): string {
  if (groupBy === "status") return MACHINE_STATUS_LABEL[key as keyof typeof MACHINE_STATUS_LABEL] ?? key;
  if (groupBy === "category") {
    return MACHINE_CATEGORY_LABEL[key as keyof typeof MACHINE_CATEGORY_LABEL] ?? key;
  }
  return EQUIPMENT_KIND_PLURAL[key as keyof typeof EQUIPMENT_KIND_PLURAL] ?? key;
}

function groupRank(key: string, groupBy: GroupBy): number {
  const order: readonly string[] =
    groupBy === "status" ? STATUS_ORDER : groupBy === "category" ? CATEGORY_ORDER : [];
  const i = order.indexOf(key);
  return i === -1 ? order.length : i;
}

/**
 * Разложить список по выбранному виду. Порядок внутри групп приходит с сервера (по учётному
 * номеру) — здесь его только переворачивают, поэтому одинаковые карточки всегда идут одинаково.
 */
export function applyView(items: MachineListItem[], view: EquipmentView): EquipmentGroup[] {
  const ordered = view.direction === "desc" ? [...items].reverse() : items;
  if (view.groupBy === "none") return [{ key: "all", title: null, items: ordered }];

  const buckets = new Map<string, MachineListItem[]>();
  for (const item of ordered) {
    const key = groupKeyOf(item, view.groupBy);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return [...buckets.entries()]
    .sort((a, b) => groupRank(a[0], view.groupBy) - groupRank(b[0], view.groupBy))
    .map(([key, group]) => ({ key, title: groupTitleOf(key, view.groupBy), items: group }));
}
