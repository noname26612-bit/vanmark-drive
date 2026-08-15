// Правила состояний станка (ARCHITECTURE §4г, PRD §16.3). Чистые функции без prisma — юнит-тесты.
//
// ВАЖНО ПРО ГРАНИЦЫ: жёсткой матрицы переходов у станков НЕТ — это осознанное продуктовое решение
// Артёма (05.08.2026). Жизнь площадки не выстраивается в граф, пользователей три, а жёсткие рёбра
// дали бы только тупики. Здесь проверяется единственный инвариант — СОВМЕСТИМОСТЬ СОСТОЯНИЯ
// С КАТЕГОРИЕЙ (нельзя «продать» клиентский станок или «сдать в аренду» тот, что на продажу).
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

// Порядок = порядок жизненного цикла: так они идут в фильтрах, плитках сводки и выпадашках.
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
 * Состояния, привязанные к одной категории. Всё, чего здесь нет (ACCEPTED, NEEDS_REPAIR,
 * IN_REPAIR, READY, VOIDED), допустимо в любой категории — станок любого происхождения может
 * стоять принятым, ждать ремонта, быть в ремонте, быть готовым или оказаться заведённым по ошибке.
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

/** Подходит ли состояние категории. Единственный инвариант состояний станка. */
export function isStatusAllowedForCategory(
  category: MachineCategory,
  status: MachineStatus,
): boolean {
  const only = CATEGORY_ONLY_STATUS[status];
  return only === undefined || only === category;
}

/** Состояния, доступные категории — строгий инвариант (сервер, фильтры списка). */
export function statusesForCategory(category: MachineCategory): MachineStatus[] {
  return MACHINE_STATUSES.filter((s) => isStatusAllowedForCategory(category, s));
}

/**
 * Состояния, которые предлагаются кнопками в карточке (Артём 15.08.2026: «точно должны быть кнопки
 * Продан, В аренде»).
 *
 * Отличие от `statusesForCategory` — только у СВОЕГО железа: наш станок можно и продать, и сдать в
 * аренду, независимо от того, для чего он заводился. Прежде это требовало сначала переключить
 * категорию, а потом состояние — два действия там, где на площадке одно событие. Категорию система
 * теперь подставляет сама (см. `categoryFollowingStatus`).
 *
 * Клиентское железо остаётся неприкосновенным: чужой станок нельзя ни продать, ни сдать — ему
 * доступен только «Выдан клиенту».
 */
export function selectableStatuses(category: MachineCategory): MachineStatus[] {
  if (!isOurCategory(category)) return statusesForCategory(category);
  return MACHINE_STATUSES.filter(
    (s) => isStatusAllowedForCategory(category, s) || s === "SOLD" || s === "RENTED",
  );
}

/**
 * Категория, в которую переезжает станок вместе с состоянием, или null — если менять нечего.
 * Продали арендный → он «наш на продажу» и продан; сдали продажный → «наш арендный» и в аренде.
 * Для клиентского железа всегда null: там несовместимость — настоящая ошибка, а не смена планов.
 */
export function categoryFollowingStatus(
  current: MachineCategory,
  next: MachineStatus,
): MachineCategory | null {
  if (isStatusAllowedForCategory(current, next)) return null;
  if (!isOurCategory(current)) return null;
  if (next === "SOLD") return "OUR_SALE";
  if (next === "RENTED") return "OUR_RENTAL";
  return null;
}

/** Категории, в которых состояние допустимо — для подсказки при смене категории. */
export function categoriesForStatus(status: MachineStatus): MachineCategory[] {
  return MACHINE_CATEGORIES.filter((c) => isStatusAllowedForCategory(c, status));
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

/** Наши станки (продажа/аренда). Учётный номер «77-N» с 15.08.2026 доступен ЛЮБОЙ категории. */
export function isOurCategory(category: MachineCategory): boolean {
  return category === "OUR_SALE" || category === "OUR_RENTAL";
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
  BENDER: ["MACHINE", "ROLLER_KNIFE"],
  SEAMER: ["SEAMER", "UNCOILER", "INVERTER"],
};

const FAMILY_OF_KIND: Record<EquipmentKind, EquipmentFamily> = {
  MACHINE: "BENDER",
  ROLLER_KNIFE: "BENDER",
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
  "SEAMER",
  "UNCOILER",
  "INVERTER",
] as const;

export const EQUIPMENT_KIND_LABEL: Record<EquipmentKind, string> = {
  MACHINE: "Листогиб",
  ROLLER_KNIFE: "Роликовый нож",
  SEAMER: "Фальцепрокатник",
  UNCOILER: "Размотчик",
  INVERTER: "Частотник",
};

/** Короткая подпись для бейджа. Головным видам бейдж не рисуем: «Листогиб» на каждой строке — шум. */
export const EQUIPMENT_KIND_SHORT: Record<EquipmentKind, string> = {
  MACHINE: "Листогиб",
  ROLLER_KNIFE: "Нож",
  SEAMER: "Фальцепрокатник",
  UNCOILER: "Размотчик",
  INVERTER: "Частотник",
};

/** Подпись плашки раздела над списком: «Листогибы · Ножи», «Фальцепрокатники · Размотчики · Частотники». */
export const EQUIPMENT_KIND_PLURAL: Record<EquipmentKind, string> = {
  MACHINE: "Листогибы",
  ROLLER_KNIFE: "Ножи",
  SEAMER: "Фальцепрокатники",
  UNCOILER: "Размотчики",
  INVERTER: "Частотники",
};

// Складские позиции держатся на фиксированных значениях: у «остатков на складе» нет ни состояния,
// ни владельца. Значения не выдуманы на месте, а собраны здесь — сервер ставит их принудительно,
// интерфейс эти поля не показывает.
export const STOCK_STATUS: MachineStatus = "READY";
export const STOCK_CATEGORY: MachineCategory = "OUR_SALE";
