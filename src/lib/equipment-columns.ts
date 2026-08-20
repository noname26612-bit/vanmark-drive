// Ширины колонок таблицы оборудования: границу заголовка тянут мышью, ширина запоминается.
//
// Настройка ЛИЧНАЯ и привязана к устройству: за ноутбуком и за большим монитором удобны разные
// ширины, поэтому храним в localStorage, а не в UiPreference (та синхронизируется между
// устройствами и предназначена для раскладки доски).
//
// Ширины — ПРОЦЕНТЫ, а не пиксели: таблица table-fixed растягивается на всю ширину экрана, и
// сохранённые пиксели на другом мониторе дали бы либо пустоту справа, либо горизонтальную полосу.
// Сумма дефолтов ровно 100.
//
// В хранилище лежат ТОЛЬКО изменённые колонки, а не все семь: колонка, которую не трогали, обязана
// поехать за дефолтом, если мы его когда-нибудь поправим, — иначе у старых пользователей навсегда
// останется вчерашняя раскладка.

export type EquipmentColumnKey =
  | "number"
  | "photo"
  | "model"
  | "status"
  | "price"
  | "thickness"
  | "due";

/** Порядок колонок слева направо — им же размечается colgroup таблицы. */
export const EQUIPMENT_COLUMNS: readonly EquipmentColumnKey[] = [
  "number",
  "photo",
  "model",
  "status",
  "price",
  "thickness",
  "due",
];

export const DEFAULT_COL_WIDTHS: Record<EquipmentColumnKey, number> = {
  number: 9,
  photo: 8,
  model: 30,
  status: 24,
  price: 11,
  thickness: 11,
  due: 7,
};

// Нижняя граница — чтобы колонку нельзя было утащить в невидимую полоску и потом не найти её
// границу обратно; верхняя — чтобы одна колонка не выдавила остальные за край экрана.
export const MIN_COL_PCT = 4;
export const MAX_COL_PCT = 70;

const STORAGE_PREFIX = "vanmark:equipment-cols:v1:";
const DEFAULT_RAW = "{}";

// Настройка читается через useSyncExternalStore: на сервере снимок всегда «по умолчанию», на
// клиенте — из localStorage. Так гидрация не расходится (урок React #418) и не нужен setState в
// эффекте. Подписчики — открытые экраны: подвинул границу, все перерисовались.
const listeners = new Set<() => void>();

export function subscribeCols(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Сырой снимок ширин. Возвращает именно СТРОКУ, а не объект: useSyncExternalStore сравнивает
 * снимки по ссылке, и новый объект на каждый вызов дал бы бесконечную перерисовку.
 */
export function colsSnapshot(family: string): string {
  if (typeof window === "undefined") return DEFAULT_RAW;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + family) ?? DEFAULT_RAW;
  } catch {
    // Недоступный localStorage (приватный режим) не должен ронять экран — ширины по умолчанию.
    return DEFAULT_RAW;
  }
}

export function serverColsSnapshot(): string {
  return DEFAULT_RAW;
}

/**
 * Ширина из хранилища или null, если это не годная ширина. Ширины вне диапазона считаем порчей, а
 * не поводом подрезать: записать такое мог только сбой — saveCol пишет уже подрезанное значение.
 */
function validPct(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_COL_PCT || value > MAX_COL_PCT) return null;
  return value;
}

/** Разбор снимка с санитизацией: в хранилище могло остаться что угодно от прошлых версий. */
export function parseCols(raw: string): Record<EquipmentColumnKey, number> {
  const widths = { ...DEFAULT_COL_WIDTHS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return widths;
  }
  if (typeof parsed !== "object" || parsed === null) return widths;
  const stored = parsed as Record<string, unknown>;
  for (const key of EQUIPMENT_COLUMNS) {
    const pct = validPct(stored[key]);
    if (pct !== null) widths[key] = pct;
  }
  return widths;
}

/** Только изменённые колонки — то, что реально лежит в хранилище (лишние ключи отсеяны). */
function readOverrides(family: string): Partial<Record<EquipmentColumnKey, number>> {
  const raw = colsSnapshot(family);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const stored = parsed as Record<string, unknown>;
  const overrides: Partial<Record<EquipmentColumnKey, number>> = {};
  for (const key of EQUIPMENT_COLUMNS) {
    const pct = validPct(stored[key]);
    if (pct !== null) overrides[key] = pct;
  }
  return overrides;
}

function writeOverrides(
  family: string,
  overrides: Partial<Record<EquipmentColumnKey, number>>,
): void {
  if (typeof window !== "undefined") {
    try {
      // Пустую запись стираем целиком: вернули всё к дефолту — не оставляем следа в хранилище.
      if (Object.keys(overrides).length === 0) {
        window.localStorage.removeItem(STORAGE_PREFIX + family);
      } else {
        window.localStorage.setItem(STORAGE_PREFIX + family, JSON.stringify(overrides));
      }
    } catch {
      // Ширины — не данные: не сохранились, значит в следующий раз откроется по умолчанию.
    }
  }
  for (const l of listeners) l();
}

function clampPct(pct: number): number {
  // Округляем: мышь даёт 30.000000000004%, и такие хвосты копятся в хранилище при каждом перетаскивании.
  return Math.round(Math.min(MAX_COL_PCT, Math.max(MIN_COL_PCT, pct)) * 100) / 100;
}

export function saveCol(family: string, key: EquipmentColumnKey, pct: number): void {
  if (!Number.isFinite(pct)) return;
  writeOverrides(family, { ...readOverrides(family), [key]: clampPct(pct) });
}

/**
 * Записать ДВЕ соседние колонки разом — так работает перетаскивание границы.
 *
 * Почему пара, а не одна колонка: ширина одной колонки сама по себе ничего не значит, значение
 * имеет только её доля среди видимых. Двигая границу, мы забираем проценты у соседа справа и
 * отдаём их левой колонке — сумма остаётся прежней, и граница едет ровно за курсором. Если менять
 * одну колонку, сумма процентов уплывает, таблица пересчитывает все доли, и граница отстаёт от
 * мыши тем сильнее, чем дальше её утащили.
 */
export function saveColPair(
  family: string,
  left: { key: EquipmentColumnKey; pct: number },
  right: { key: EquipmentColumnKey; pct: number },
): void {
  if (!Number.isFinite(left.pct) || !Number.isFinite(right.pct)) return;
  writeOverrides(family, {
    ...readOverrides(family),
    [left.key]: clampPct(left.pct),
    [right.key]: clampPct(right.pct),
  });
}

/**
 * Доли видимых колонок в процентах, нормализованные к сотне.
 *
 * Нормализация обязательна: колонка «Срок» показывается не всегда, и без неё сумма сохранённых
 * процентов равна 93, а не 100. Что с этим остатком сделает браузер — деталь его реализации
 * table-fixed; полагаться на неё нельзя, иначе одна и та же раскладка выглядит по-разному в
 * зависимости от того, есть ли в выборке сроки.
 */
export function visibleColWidths(
  widths: Record<EquipmentColumnKey, number>,
  visible: readonly EquipmentColumnKey[],
): Record<string, number> {
  const total = visible.reduce((sum, key) => sum + widths[key], 0);
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const key of visible) out[key] = (widths[key] / total) * 100;
  return out;
}

/**
 * Колонки обратно к дефолту — двойным щелчком по границе.
 *
 * Ключей два, потому что и тянули двоих: границу делят левая колонка и её сосед справа, и вернуть
 * одну, оставив вторую сжатой, значило бы «сбросил, а стало не как было».
 */
export function resetCol(family: string, ...keys: EquipmentColumnKey[]): void {
  const overrides = readOverrides(family);
  for (const key of keys) delete overrides[key];
  writeOverrides(family, overrides);
}

export function resetAllCols(family: string): void {
  writeOverrides(family, {});
}
