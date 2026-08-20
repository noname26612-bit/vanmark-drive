// Правила состояний станка (ARCHITECTURE §4г, PRD §16.3). Чистые функции без prisma — юнит-тесты.
//
// ВАЖНО ПРО ГРАНИЦЫ: жёсткой матрицы переходов у станков НЕТ — это осознанное продуктовое решение
// Артёма (05.08.2026). Жизнь площадки не выстраивается в граф, пользователей три, а жёсткие рёбра
// дали бы только тупики. Здесь проверяется единственный инвариант — СОВМЕСТИМОСТЬ СОСТОЯНИЯ
// С КАТЕГОРИЯМИ (нельзя «продать» клиентский станок или «выдать клиенту» наш).
//
// Статусная матрица ЗАДАЧ (src/domain/task-status.ts, CLAUDE.md правило 2) этим модулем не
// используется и не менялась ни на строку.
import type {
  EquipmentFamily,
  EquipmentKind,
  MachineCategory,
  MachineStatus,
} from "@/generated/prisma/enums";

export const MACHINE_CATEGORIES: readonly MachineCategory[] = [
  "CLIENT",
  "OUR_SALE",
  "OUR_RENTAL",
] as const;

// Порядок = порядок жизненного цикла: так они идут в фильтрах, плитках сводки и на кнопках.
export const MACHINE_STATUSES: readonly MachineStatus[] = [
  "ACCEPTED",
  "NEEDS_REPAIR",
  "IN_REPAIR",
  "READY",
  "RENTED",
  "RELEASED",
  "SOLD",
  "VOIDED",
] as const;

/**
 * «Принят» выведен из оборота (решение Артёма 20.08.2026): на площадке он ничего не значил —
 * станок приезжает уже с работой, и карточку сразу переводили в «Требует ремонта». Само значение
 * из enum не убрано: на него ссылается история (MachineEvent), и подпись ему по-прежнему нужна.
 * Предлагать его перестаём везде — кнопки, фильтры, счётчики, группировка берут этот список.
 */
export const RETIRED_MACHINE_STATUSES: ReadonlySet<MachineStatus> = new Set<MachineStatus>([
  "ACCEPTED",
]);

export function isRetiredStatus(status: MachineStatus): boolean {
  return RETIRED_MACHINE_STATUSES.has(status);
}

/** Состояния, которые вообще можно выбрать сегодня (без выведенных из оборота). */
export const SELECTABLE_MACHINE_STATUSES: readonly MachineStatus[] = MACHINE_STATUSES.filter(
  (s) => !isRetiredStatus(s),
);

/**
 * Состояния, требующие определённой категории В СПИСКЕ. Всё, чего здесь нет (NEEDS_REPAIR,
 * IN_REPAIR, READY, VOIDED), допустимо при любых категориях — станок любого происхождения может
 * ждать ремонта, быть в ремонте, быть готовым или оказаться заведённым по ошибке.
 */
const CATEGORY_ONLY_STATUS: Partial<Record<MachineStatus, MachineCategory>> = {
  RENTED: "OUR_RENTAL", // «в аренде» бывает только у нашего арендного
  SOLD: "OUR_SALE", // «продан» — только у нашего на продажу
  RELEASED: "CLIENT", // «выдан клиенту» — только у клиентского
};

/**
 * Архивные состояния: станок уехал с площадки или карточка аннулирована. Из основного списка
 * уходят в «Архив», из счётчиков сводки VOIDED исключается совсем.
 *
 * RENTED архивным НЕ является (поправка совета): аренда возвращается в цикл — станок приедет
 * обратно и снова станет READY/NEEDS_REPAIR. Возврат из архива тоже разрешён: клиент привёз тот же
 * станок повторно — живёт та же карточка, история копится.
 */
const ARCHIVED: ReadonlySet<MachineStatus> = new Set<MachineStatus>(["RELEASED", "SOLD", "VOIDED"]);

export function isArchivedStatus(status: MachineStatus): boolean {
  return ARCHIVED.has(status);
}

// ─────────────────────────────── Категории: список, а не одна ───────────────────────────────
// Решение Артёма 20.08.2026: «наш на продажу может быть и арендным». Один и тот же станок стоит
// на площадке и под продажу, и под аренду — какая из них «настоящая», решает покупатель, а не
// карточка. Отсюда список категорий с двумя правилами, которые держит этот модуль.

/** Приводит набор к каноническому порядку без дублей — чтобы галочки и журнал не прыгали. */
export function normalizeCategories(
  categories: readonly MachineCategory[],
): MachineCategory[] {
  return MACHINE_CATEGORIES.filter((c) => categories.includes(c));
}

/**
 * Допустим ли набор категорий.
 *
 * Правил ровно два (Артём 20.08.2026): набор не бывает пустым, а «Клиентский» ни с чем не
 * совмещается — чужое железо остаётся чужим, продавать и сдавать его мы не вправе. Совмещаются
 * только наши: «на продажу» + «арендный».
 */
export function isValidCategorySet(categories: readonly MachineCategory[]): boolean {
  if (categories.length === 0) return false;
  if (categories.includes("CLIENT") && categories.length > 1) return false;
  return true;
}

/** Наш ли это станок (нет клиентской категории). «77-N» против «К-N» решается этим же признаком. */
export function isOurCategories(categories: readonly MachineCategory[]): boolean {
  return !categories.includes("CLIENT");
}

/** Подходит ли состояние набору категорий. Единственный инвариант состояний станка. */
export function isStatusAllowedForCategories(
  categories: readonly MachineCategory[],
  status: MachineStatus,
): boolean {
  const only = CATEGORY_ONLY_STATUS[status];
  return only === undefined || categories.includes(only);
}

/** Состояния, допустимые набору категорий — строгий инвариант (сервер, фильтры списка). */
export function statusesForCategories(
  categories: readonly MachineCategory[],
): MachineStatus[] {
  return SELECTABLE_MACHINE_STATUSES.filter((s) => isStatusAllowedForCategories(categories, s));
}

/**
 * Состояния, которые предлагаются кнопками в карточке (Артём 15.08.2026: «точно должны быть кнопки
 * Продан, В аренде»).
 *
 * Отличие от `statusesForCategories` — только у СВОЕГО железа: наш станок можно и продать, и сдать
 * в аренду, независимо от того, для чего он заводился. Прежде это требовало сначала переключить
 * категорию, а потом состояние — два действия там, где на площадке одно событие. Недостающую
 * категорию система теперь дописывает сама (см. `categoriesFollowingStatus`).
 *
 * Клиентское железо остаётся неприкосновенным: чужой станок нельзя ни продать, ни сдать — ему
 * доступен только «Выдан клиенту».
 */
export function selectableStatuses(categories: readonly MachineCategory[]): MachineStatus[] {
  if (!isOurCategories(categories)) return statusesForCategories(categories);
  return SELECTABLE_MACHINE_STATUSES.filter(
    (s) => isStatusAllowedForCategories(categories, s) || s === "SOLD" || s === "RENTED",
  );
}

/**
 * Набор категорий, в который переезжает станок вместе с состоянием, или null — если менять нечего.
 *
 * Важное отличие от прежней одиночной категории: недостающая категория ДОБАВЛЯЕТСЯ, а не заменяет
 * прежнюю. Сдали в аренду станок, стоявший на продажу, — он и арендный, и по-прежнему продаётся:
 * вернётся из аренды и снова будет ждать покупателя. Затирать вторую категорию значило бы терять
 * то, что Артём как раз и просил сохранять.
 *
 * Для клиентского железа всегда null: там несовместимость — настоящая ошибка, а не смена планов.
 */
export function categoriesFollowingStatus(
  current: readonly MachineCategory[],
  next: MachineStatus,
): MachineCategory[] | null {
  if (isStatusAllowedForCategories(current, next)) return null;
  if (!isOurCategories(current)) return null;
  const add = next === "SOLD" ? "OUR_SALE" : next === "RENTED" ? "OUR_RENTAL" : null;
  if (add === null) return null;
  return normalizeCategories([...current, add]);
}

/** Категории, в которых состояние допустимо — для подсказки при смене категорий. */
export function categoriesForStatus(status: MachineStatus): MachineCategory[] {
  return MACHINE_CATEGORIES.filter((c) => isStatusAllowedForCategories([c], status));
}

/** Требуется ли причина при переводе в это состояние. Только аннулирование (лечение дублей). */
export function reasonRequiredFor(status: MachineStatus): boolean {
  return status === "VOIDED";
}

// ─────────────────────────────── Подписи (используются и на сервере) ───────────────────────────────
// Держим в домене, а не только в UI: тексты уходят ещё и в журнал событий («было→стало»),
// который читается как история — там нужны те же слова, что видит человек на экране.

export const MACHINE_CATEGORY_LABEL: Record<MachineCategory, string> = {
  CLIENT: "Клиентский",
  OUR_SALE: "Наш на продажу",
  OUR_RENTAL: "Наш арендный",
};

export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = {
  ACCEPTED: "Принят",
  NEEDS_REPAIR: "Требует ремонта",
  IN_REPAIR: "В ремонте",
  READY: "Готов",
  RENTED: "В аренде",
  RELEASED: "Выдан клиенту",
  SOLD: "Продан",
  VOIDED: "Аннулирован",
};

/**
 * Подпись набора категорий одной строкой: «Наш на продажу + Наш арендный». Нужна и журналу
 * («было → стало»), и заголовкам групп списка — поэтому живёт рядом с остальными подписями.
 */
export function categoriesLabel(categories: readonly MachineCategory[]): string {
  const normalized = normalizeCategories(categories);
  if (normalized.length === 0) return "—";
  return normalized.map((c) => MACHINE_CATEGORY_LABEL[c]).join(" + ");
}

// ─────────────────────────────── Разделы и виды оборудования ───────────────────────────────
// Всё оборудование живёт в ОДНОЙ картотеке (решение Артёма 07.08.2026, расширено 15.08.2026):
// своих полей ни у ножей, ни у складских позиций нет — общих хватает. Разделяют два измерения:
//
//   family — вкладка интерфейса и область уникальности номера «77-N»;
//   kind   — что это за железо внутри раздела.
//
// Складские виды (размотчики, частотники) ведутся КОЛИЧЕСТВОМ: одна карточка на модель, поле
// quantity. Состояний, категорий и сроков у них нет — они «просто остатки на складе».

export const EQUIPMENT_FAMILIES: readonly EquipmentFamily[] = ["BENDER", "SEAMER"] as const;

export const EQUIPMENT_FAMILY_LABEL: Record<EquipmentFamily, string> = {
  BENDER: "Листогибы",
  SEAMER: "Фальцепрокатники",
};

/** Виды раздела. Первый — головной: он идёт по умолчанию в форме и держит комплект. */
export const KINDS_BY_FAMILY: Record<EquipmentFamily, readonly EquipmentKind[]> = {
  BENDER: ["MACHINE", "ROLLER_KNIFE", "FALZ_MACHINE"],
  SEAMER: ["SEAMER", "UNCOILER", "INVERTER"],
};

const FAMILY_OF_KIND: Record<EquipmentKind, EquipmentFamily> = {
  MACHINE: "BENDER",
  ROLLER_KNIFE: "BENDER",
  FALZ_MACHINE: "BENDER",
  SEAMER: "SEAMER",
  UNCOILER: "SEAMER",
  INVERTER: "SEAMER",
};

/** Раздел, которому принадлежит вид. Источник правды для валидации «вид не из этого раздела». */
export function familyOfKind(kind: EquipmentKind): EquipmentFamily {
  return FAMILY_OF_KIND[kind];
}

export function isKindInFamily(family: EquipmentFamily, kind: EquipmentKind): boolean {
  return FAMILY_OF_KIND[kind] === family;
}

/** Головной вид раздела — тот, к которому собирается комплект (листогиб, фальцепрокатник). */
export function headKindOf(family: EquipmentFamily): EquipmentKind {
  return KINDS_BY_FAMILY[family][0];
}

export function isHeadKind(kind: EquipmentKind): boolean {
  return kind === "MACHINE" || kind === "SEAMER";
}

/**
 * Складская позиция: карточка = модель, а не экземпляр. Ведётся количеством, состояния и категория
 * к ней не применяются (сервер держит их фиксированными), в счётчики состояний она не попадает.
 */
export function isStockKind(kind: EquipmentKind): boolean {
  return kind === "UNCOILER" || kind === "INVERTER";
}

export const EQUIPMENT_KINDS: readonly EquipmentKind[] = [
  "MACHINE",
  "ROLLER_KNIFE",
  "FALZ_MACHINE",
  "SEAMER",
  "UNCOILER",
  "INVERTER",
] as const;

export const EQUIPMENT_KIND_LABEL: Record<EquipmentKind, string> = {
  MACHINE: "Листогиб",
  ROLLER_KNIFE: "Роликовый нож",
  FALZ_MACHINE: "Фальц машинка",
  SEAMER: "Фальцепрокатник",
  UNCOILER: "Размотчик",
  INVERTER: "Частотник",
};

/** Короткая подпись для бейджа. Головным видам бейдж не рисуем: «Листогиб» на каждой строке — шум. */
export const EQUIPMENT_KIND_SHORT: Record<EquipmentKind, string> = {
  MACHINE: "Листогиб",
  ROLLER_KNIFE: "Нож",
  FALZ_MACHINE: "Машинка",
  SEAMER: "Фальцепрокатник",
  UNCOILER: "Размотчик",
  INVERTER: "Частотник",
};

/** Подпись плашки раздела над списком: «Листогибы · Ножи», «Фальцепрокатники · Размотчики · Частотники». */
export const EQUIPMENT_KIND_PLURAL: Record<EquipmentKind, string> = {
  MACHINE: "Листогибы",
  ROLLER_KNIFE: "Ножи",
  FALZ_MACHINE: "Фальц машинки",
  SEAMER: "Фальцепрокатники",
  UNCOILER: "Размотчики",
  INVERTER: "Частотники",
};

// Складские позиции держатся на фиксированных значениях: у «остатков на складе» нет ни состояния,
// ни владельца. Значения не выдуманы на месте, а собраны здесь — сервер ставит их принудительно,
// интерфейс эти поля не показывает.
export const STOCK_STATUS: MachineStatus = "READY";
export const STOCK_CATEGORIES: readonly MachineCategory[] = ["OUR_SALE"] as const;
