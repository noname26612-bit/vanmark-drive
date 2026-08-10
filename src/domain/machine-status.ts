// Правила состояний станка (ARCHITECTURE §4г, PRD §16.3). Чистые функции без prisma — юнит-тесты.
//
// ВАЖНО ПРО ГРАНИЦЫ: жёсткой матрицы переходов у станков НЕТ — это осознанное продуктовое решение
// Артёма (05.08.2026). Жизнь площадки не выстраивается в граф, пользователей три, а жёсткие рёбра
// дали бы только тупики. Здесь проверяется единственный инвариант — СОВМЕСТИМОСТЬ СОСТОЯНИЯ
// С КАТЕГОРИЕЙ (нельзя «продать» клиентский станок или «сдать в аренду» тот, что на продажу).
//
// Статусная матрица ЗАДАЧ (src/domain/task-status.ts, CLAUDE.md правило 2) этим модулем не
// используется и не менялась ни на строку.
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";

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

/** Состояния, доступные категории — для выпадашки в карточке (не даём выбрать заведомо неверное). */
export function statusesForCategory(category: MachineCategory): MachineStatus[] {
  return MACHINE_STATUSES.filter((s) => isStatusAllowedForCategory(category, s));
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

/** Наши станки (продажа/аренда) — им положен номер «77-N»; клиентским он не нужен. */
export function isOurCategory(category: MachineCategory): boolean {
  return category === "OUR_SALE" || category === "OUR_RENTAL";
}

// ─────────────────────────────── Вид оборудования ───────────────────────────────
// Б/у роликовые ножи ведутся в ТОЙ ЖЕ картотеке (решение Артёма 07.08.2026): своих полей у ножей
// нет, общих хватает; вид ортогонален категории и состоянию. Раздел по-прежнему зовётся «Станки».

export const EQUIPMENT_KINDS: readonly EquipmentKind[] = ["MACHINE", "ROLLER_KNIFE"] as const;

export const EQUIPMENT_KIND_LABEL: Record<EquipmentKind, string> = {
  MACHINE: "Станок",
  ROLLER_KNIFE: "Роликовый нож",
};

/** Короткая подпись для бейджа и чипов. Бейдж вида показываем только ножам: «Станок» на каждой строке — шум. */
export const EQUIPMENT_KIND_SHORT: Record<EquipmentKind, string> = {
  MACHINE: "Станок",
  ROLLER_KNIFE: "Нож",
};
