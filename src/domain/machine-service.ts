// Доменный сервис картотеки станков (ARCHITECTURE §4г, PRD §16). Вся логика модуля — здесь,
// route handlers остаются тонкими.
//
// Права: КАЖДАЯ экспортируемая функция начинается с assertMachineAccess(actor) — модуль защищён
// только ролью (изоляции «по владельцу» у общей картотеки нет by design, §6). Личность — из сессии.
//
// Журнал (MachineEvent) — только на запись, как TaskEvent: правки не переписывают историю, а
// добавляют событие с «было→стало». Optimistic-lock сознательно не делаем (пользователей три).
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { assertMachineAccess, isMachineRole } from "./machine-access";
import {
  NUMBER_PREFIX,
  formatMachineNumber,
  formatNumberIn,
  numberFieldFor,
  numberSchemeFor,
  type NumberScheme,
} from "./machine-number";
import {
  categoriesFollowingStatus,
  categoriesLabel,
  isArchivedStatus,
  isRetiredStatus,
  isExclusiveCategory,
  isStatusAllowedForCategories,
  isValidCategorySet,
  isKindInFamily,
  isStockKind,
  isHeadKind,
  headKindOf,
  normalizeCategories,
  reasonRequiredFor,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_FAMILY_LABEL,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
  STOCK_CATEGORIES,
  STOCK_STATUS,
} from "./machine-status";
import {
  assertAttachable,
  consumesStock,
  freeStock,
  transfersStatus,
  type KitLink,
} from "./machine-kit";
import { machineFlags, summarize, type FlaggableMachine } from "./machine-flags";
import { machineMatches, parseQuery } from "@/lib/machine-search";
import { buildShopTaskText } from "@/lib/machine-shop-task";
import { utcDateKey } from "./kpi";
import type { Prisma } from "@/generated/prisma/client";
import type {
  EquipmentFamily,
  EquipmentKind,
  MachineCategory,
  MachineStatus,
  Role,
} from "@/generated/prisma/enums";
import type {
  KitHeadView,
  KitPartView,
  MachineChange,
  MachineDetail,
  MachineListItem,
  MachineListResult,
} from "@/lib/machine-dto";

/**
 * Кто выполняет операцию. equipmentAccess — персональный флаг допуска к оборудованию (15.08.2026),
 * его подкладывает guard, прочитав из БД: у ролевых пользователей он не нужен, у водителя решает всё.
 */
export type Actor = { id: string; role: Role; equipmentAccess?: boolean };

/**
 * Состояние новой карточки. «Принят» выведен из оборота 20.08.2026 (решение Артёма): станок
 * приезжает уже с работой, и карточку тут же переводили руками — лишний шаг убран.
 */
const DEFAULT_MACHINE_STATUS: MachineStatus = "NEEDS_REPAIR";

const MAX_TEXT = 2000; // потолок на длинные текстовые поля (дефектовка/заметки)
const MAX_SHORT = 200; // потолок на короткие поля (модель, место, контакт…)
const CHANGE_VALUE_MAX = 120; // сколько символа значения храним в «было→стало» (журнал не архив текстов)
const ARCHIVE_PAGE = 30;

// ───────────────────────────────── вход ─────────────────────────────────

export type MachineFields = {
  ourNumber: number | null;
  clientNumber: number | null;
  kind: EquipmentKind;
  /** Остаток на складе — принимается только у складских видов (размотчик, частотник). */
  quantity: number;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  /** Цена в рублях, целыми (20.08.2026). Одна на продажу и аренду — см. schema.prisma. */
  price: number | null;
  contactName: string | null;
  invoice1C: string | null;
  responsibleId: string | null;
  deliveredBy: string | null;
  arrivedAt: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD — срок готовности/выдачи
  isUrgent: boolean;
  defectNotes: string | null;
  notes: string | null;
};

/**
 * Создание: обязательны ТОЛЬКО категории и модель (PRD §16.4) — инвентаризацию нельзя блокировать.
 * family приходит из раздела, в котором открыт экран, и потом не меняется: перенос карточки между
 * «Листогибами» и «Фальцепрокатниками» — это заведомо ошибка ввода, её лечат аннулированием.
 */
export type CreateMachineInput = Partial<MachineFields> & {
  categories: MachineCategory[];
  family?: EquipmentFamily;
};
export type EditMachineInput = Partial<MachineFields>;

// ───────────────────────────────── выборки ─────────────────────────────────

// Комплект в выборке списка: обе стороны связи. Данных немного (десятки карточек), зато строка
// списка сразу знает, что уедет вместе, и клиенту не нужен второй запрос.
const kitSelect = {
  kitParts: {
    select: {
      qty: true,
      consumedAt: true,
      part: {
        select: {
          id: true,
          ourNumber: true,
          clientNumber: true,
          kind: true,
          model: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  kitOf: {
    select: {
      qty: true,
      consumedAt: true,
      head: {
        select: { id: true, ourNumber: true, clientNumber: true, model: true },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

const listSelect = {
  id: true,
  number: true,
  ourNumber: true,
  clientNumber: true,
  family: true,
  kind: true,
  quantity: true,
  categories: true,
  status: true,
  model: true,
  configuration: true,
  metalThickness: true,
  price: true,
  contactName: true,
  invoice1C: true,
  deliveredBy: true,
  defectNotes: true,
  notes: true,
  isUrgent: true,
  arrivedAt: true,
  dueDate: true,
  diagnosedAt: true,
  lastVerifiedAt: true,
  responsibleId: true,
  responsible: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
  attachments: { select: { id: true }, orderBy: { createdAt: "asc" } },
  ...kitSelect,
} as const;

// Лёгкая выборка для счётчиков сводки: только поля, от которых зависят индикаторы.
const flagSelect = {
  kind: true,
  quantity: true,
  categories: true,
  status: true,
  isUrgent: true,
  dueDate: true,
  diagnosedAt: true,
  lastVerifiedAt: true,
  createdAt: true,
} as const;

type KitPartRow = {
  qty: number;
  consumedAt: Date | null;
  part: {
    id: string;
    ourNumber: number | null;
    clientNumber: number | null;
    kind: EquipmentKind;
    model: string;
    status: MachineStatus;
  };
};

type KitHeadRow = {
  qty: number;
  consumedAt: Date | null;
  head: {
    id: string;
    ourNumber: number | null;
    clientNumber: number | null;
    model: string;
  };
};

type ListRow = {
  id: string;
  number: number;
  ourNumber: number | null;
  clientNumber: number | null;
  family: EquipmentFamily;
  kind: EquipmentKind;
  quantity: number;
  categories: MachineCategory[];
  status: MachineStatus;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  price: number | null;
  contactName: string | null;
  invoice1C: string | null;
  deliveredBy: string | null;
  defectNotes: string | null;
  notes: string | null;
  isUrgent: boolean;
  arrivedAt: Date | null;
  dueDate: Date | null;
  diagnosedAt: Date | null;
  lastVerifiedAt: Date | null;
  responsibleId: string | null;
  responsible: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  attachments: { id: string }[];
  kitParts: KitPartRow[];
  kitOf: KitHeadRow[];
};

function toKitPart(r: KitPartRow): KitPartView {
  return {
    id: r.part.id,
    ourNumber: r.part.ourNumber,
    clientNumber: r.part.clientNumber,
    kind: r.part.kind,
    model: r.part.model,
    status: r.part.status,
    qty: r.qty,
    consumedAt: r.consumedAt?.toISOString() ?? null,
  };
}

function toKitHead(r: KitHeadRow): KitHeadView {
  return {
    id: r.head.id,
    ourNumber: r.head.ourNumber,
    clientNumber: r.head.clientNumber,
    model: r.head.model,
    qty: r.qty,
  };
}

function toListItem(m: ListRow): MachineListItem {
  const kitOf: KitLink[] = m.kitOf.map((r) => ({ qty: r.qty, consumedAt: r.consumedAt }));
  return {
    id: m.id,
    number: m.number,
    ourNumber: m.ourNumber,
    clientNumber: m.clientNumber,
    family: m.family,
    kind: m.kind,
    quantity: m.quantity,
    // Свободный остаток осмыслен только у складских позиций; у штучного оборудования это всегда 1
    // (иначе строка списка показывала бы «свободно 0» у ножа, стоящего в комплекте, — а он не склад).
    freeQuantity: isStockKind(m.kind) ? freeStock(m.quantity, kitOf) : m.quantity,
    kitParts: m.kitParts.map(toKitPart),
    kitHeads: m.kitOf.map(toKitHead),
    categories: normalizeCategories(m.categories),
    status: m.status,
    model: m.model,
    configuration: m.configuration,
    metalThickness: m.metalThickness,
    price: m.price,
    contactName: m.contactName,
    invoice1C: m.invoice1C,
    deliveredBy: m.deliveredBy,
    defectNotes: m.defectNotes,
    notes: m.notes,
    isUrgent: m.isUrgent,
    arrivedAt: m.arrivedAt ? utcDateKey(m.arrivedAt) : null,
    dueDate: m.dueDate ? utcDateKey(m.dueDate) : null,
    diagnosedAt: m.diagnosedAt?.toISOString() ?? null,
    lastVerifiedAt: m.lastVerifiedAt?.toISOString() ?? null,
    responsibleId: m.responsibleId,
    responsibleName: m.responsible?.name ?? null,
    photoId: m.attachments[0]?.id ?? null,
    photoCount: m.attachments.length,
    updatedAt: m.updatedAt.toISOString(),
  };
}

// ───────────────────────────────── валидация ─────────────────────────────────

/**
 * Текстовое поле: пустая строка = «очистить» (null). Слишком длинное значение НЕ обрезаем молча —
 * человек не должен обнаружить потерю хвоста дефектовки постфактум; говорим об этом сразу.
 */
function trimTo(v: string | null | undefined, max: number, label = "Поле"): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) {
    throw Errors.validation(`${label}: слишком длинный текст (максимум ${max} символов)`);
  }
  return s;
}

function parseDay(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Errors.validation("Дата должна быть в формате YYYY-MM-DD");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw Errors.validation("Некорректная дата");
  return d;
}

/**
 * Ответственный менеджер — активный сотрудник офиса. Проверка БЕЛЫМ списком ролей (isMachineRole),
 * тем же, что фильтрует выпадашку в listResponsibles: «все кроме водителя» разъехалось бы с формой,
 * как только в enum добавят следующую роль (ровно так и появился SERVICE_MANAGER).
 */
async function assertResponsible(responsibleId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: responsibleId },
    select: { role: true, isActive: true },
  });
  if (!user || !user.isActive || !isMachineRole(user.role)) {
    throw Errors.validation("Ответственным можно назначить только сотрудника офиса");
  }
}

type FieldPatch = Record<string, unknown>;

// Поля с подписями: подпись нужна, чтобы ошибка длины называла конкретное поле, а не «слишком длинно».
const SHORT_FIELDS = [
  ["configuration", "Комплектация"],
  ["metalThickness", "Толщина металла"],
  ["contactName", "Контакт"],
  ["invoice1C", "№ заказа 1С"],
  ["deliveredBy", "Кто привёз"],
] as const;

const LONG_FIELDS = [
  ["defectNotes", "Дефектовка"],
  ["notes", "Заметки"],
] as const;

/**
 * Разбор полей карточки в данные Prisma. Пустая строка = «очистить поле» (null): менеджер стёр
 * значение — так и записываем, иначе поле нельзя было бы освободить.
 */
async function buildFields(
  input: EditMachineInput,
  ctx: { categories: readonly MachineCategory[]; family: EquipmentFamily; kind: EquipmentKind },
): Promise<FieldPatch> {
  const patch: FieldPatch = {};

  if ("model" in input) {
    const model = trimTo(input.model, MAX_SHORT, "Модель");
    if (!model) throw Errors.validation("Укажите модель станка");
    patch.model = model;
  }
  for (const [key, label] of SHORT_FIELDS) {
    if (key in input) patch[key] = trimTo(input[key], MAX_SHORT, label);
  }
  for (const [key, label] of LONG_FIELDS) {
    if (key in input) patch[key] = trimTo(input[key], MAX_TEXT, label);
  }
  if ("isUrgent" in input) patch.isUrgent = input.isUrgent === true;

  // Цена в рублях, целыми. Потолок в сто миллионов — не «бизнес-правило», а защита от опечатки
  // в лишний ноль: б/у листогиб столько не стоит, а поймать это на вводе дешевле, чем в отчёте.
  if ("price" in input) {
    const raw = input.price;
    if (raw === null || raw === undefined) {
      patch.price = null;
    } else if (!Number.isInteger(raw) || raw < 0 || raw > 100_000_000) {
      throw Errors.validation("Цена — целое число рублей от 0");
    } else {
      patch.price = raw;
    }
  }

  if ("arrivedAt" in input) {
    const raw = input.arrivedAt;
    patch.arrivedAt = typeof raw === "string" && raw.trim() ? parseDay(raw.trim()) : null;
  }

  if ("dueDate" in input) {
    const raw = input.dueDate;
    patch.dueDate = typeof raw === "string" && raw.trim() ? parseDay(raw.trim()) : null;
  }

  // Вид меняется только внутри своего раздела: «нож» в разделе фальцепрокатников и «размотчик» у
  // листогибов означали бы, что карточка попала не туда, — а раздел карточки неизменен.
  const kind = "kind" in input && input.kind ? input.kind : ctx.kind;
  if ("kind" in input) {
    if (!input.kind || !EQUIPMENT_KIND_LABEL[input.kind]) {
      throw Errors.validation("Неизвестный вид оборудования");
    }
    if (!isKindInFamily(ctx.family, input.kind)) {
      throw Errors.validation(
        `«${EQUIPMENT_KIND_LABEL[input.kind]}» — не из раздела «${EQUIPMENT_FAMILY_LABEL[ctx.family]}»`,
      );
    }
    // Складской остаток и штучная карточка — разные сущности: у первого карточка = модель с
    // количеством, у второго = конкретное железо с номером, состоянием и категориями. Превращение
    // одного в другое оставляло карточку в невозможном виде — например «выдан клиенту» у остатка,
    // которого нет ни в списке площадки, ни в архиве, и вернуть её оттуда было нечем.
    if (isStockKind(input.kind) !== isStockKind(ctx.kind)) {
      throw Errors.validation(
        "Складской остаток и штучное оборудование — разные карточки: заведите новую",
      );
    }
    patch.kind = input.kind;
  }

  // Количество — только у складских позиций (остатки на складе). У штучного оборудования карточка
  // всегда одна единица железа, поэтому поле молча не принимаем, а говорим об этом.
  if ("quantity" in input && input.quantity !== undefined) {
    if (!isStockKind(kind)) {
      throw Errors.validation("Количество ведётся только у размотчиков и частотников");
    }
    const q = input.quantity;
    if (!Number.isInteger(q) || q < 0 || q > 10_000) {
      throw Errors.validation("Количество — целое число от 0");
    }
    patch.quantity = q;
  }

  // Учётный номер живёт в поле своей схемы: «77-N» у своего железа, «К-N» у клиентского
  // (решение Артёма 15.08.2026, вечер). Схему берём из категорий карточки — форма шлёт номер той
  // схемы, которую показывает; чужое поле принять нельзя, иначе номер разъедется с категориями.
  for (const field of ["ourNumber", "clientNumber"] as const) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (raw === null || raw === undefined) {
      patch[field] = null;
      continue;
    }
    if (!Number.isInteger(raw) || raw < 1 || raw > 100_000) {
      throw Errors.validation("Учётный номер — целое число больше нуля");
    }
    if (field !== numberFieldFor(ctx.categories)) {
      throw Errors.validation(
        `Номер «${NUMBER_PREFIX[numberSchemeFor(ctx.categories)]}N» — для категорий «${categoriesLabel(ctx.categories)}»`,
      );
    }
    patch[field] = raw;
  }

  if ("responsibleId" in input) {
    const raw = input.responsibleId;
    if (raw === null || raw === undefined || raw === "") {
      patch.responsibleId = null;
    } else {
      await assertResponsible(raw);
      patch.responsibleId = raw;
    }
  }

  return patch;
}

/** Дубль «77-N» — человеческая ошибка ввода при инвентаризации, а не 500 (решение Артёма). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

// ───────────────────────────────── журнал ─────────────────────────────────

// Поля, попадающие в «было→стало». Ключевые для расследования («кто передвинул станок») идут
// первыми; длинные тексты тоже пишем, но обрезанными — журнал не хранилище текстов.
const TRACKED: { field: keyof MachineFields | "categories"; label: string }[] = [
  { field: "kind", label: "Вид" },
  { field: "categories", label: "Категории" },
  // Количество обязано быть здесь: правку пишет buildChanges, и поле, которого нет в списке, даёт
  // пустой диф — editMachine выходит раньше записи, и остаток молча остаётся прежним.
  { field: "quantity", label: "На складе, шт" },
  { field: "responsibleId", label: "Ответственный" },
  { field: "ourNumber", label: "Номер" },
  { field: "clientNumber", label: "Номер" },
  { field: "model", label: "Модель" },
  { field: "configuration", label: "Комплектация" },
  { field: "metalThickness", label: "Толщина металла" },
  { field: "price", label: "Цена" },
  { field: "contactName", label: "Контакт" },
  { field: "invoice1C", label: "Заказ 1С" },
  { field: "deliveredBy", label: "Кто привёз" },
  { field: "arrivedAt", label: "Дата поступления" },
  { field: "dueDate", label: "Срок" },
  { field: "isUrgent", label: "Срочно" },
  { field: "defectNotes", label: "Дефектовка" },
  { field: "notes", label: "Заметки" },
];

/** Значение поля в человекочитаемом виде для журнала. */
function displayValue(field: string, value: unknown, names: Map<string, string>): string | null {
  if (value === null || value === undefined) return null;
  if (field === "kind") return EQUIPMENT_KIND_LABEL[value as EquipmentKind];
  if (field === "categories") return categoriesLabel(value as MachineCategory[]);
  if (field === "responsibleId") return names.get(String(value)) ?? "—";
  if (field === "ourNumber") return formatNumberIn("OUR", Number(value));
  if (field === "clientNumber") return formatNumberIn("CLIENT", Number(value));
  if (field === "isUrgent") return value === true ? "да" : "нет";
  // Цена читается глазами в отчёте — «120 000 ₽» вместо «120000».
  if (field === "price") return `${Number(value).toLocaleString("ru-RU")} ₽`;
  if (value instanceof Date) {
    const [y, m, d] = utcDateKey(value).split("-");
    return `${d}.${m}.${y}`;
  }
  const s = String(value);
  if (!s.trim()) return null;
  return s.length > CHANGE_VALUE_MAX ? `${s.slice(0, CHANGE_VALUE_MAX)}…` : s;
}

/** Сопоставимый ключ значения поля: дата — по времени, список — по содержимому, остальное как есть. */
function changeKey(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.join("|");
  return value;
}

/** Диф правки: только реально изменившиеся поля. Пустой диф → события не пишем и БД не трогаем. */
function buildChanges(
  before: Record<string, unknown>,
  patch: FieldPatch,
  names: Map<string, string>,
): MachineChange[] {
  const out: MachineChange[] = [];
  for (const { field, label } of TRACKED) {
    if (!(field in patch)) continue;
    const from = before[field] ?? null;
    const to = patch[field] ?? null;
    // Сравниваем по «ключу», а не по ссылке: даты и списки категорий равны по содержимому, и без
    // этого журнал писал бы событие «Категории: Наш на продажу → Наш на продажу» на каждую правку.
    const fromKey = changeKey(from);
    const toKey = changeKey(to);
    if (fromKey === toKey) continue;
    out.push({
      field: String(field),
      label,
      from: displayValue(String(field), from, names),
      to: displayValue(String(field), to, names),
    });
  }
  return out;
}

/** Имена пользователей, упомянутых в дифе (ответственный «было» и «стало»). */
async function namesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

// ───────────────────────────────── операции ─────────────────────────────────

/** Завести карточку. Раздел приходит с экрана; карточка не ждёт фото. */
export async function createMachine(input: CreateMachineInput, actor: Actor): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const family: EquipmentFamily = input.family ?? "BENDER";
  if (!EQUIPMENT_FAMILY_LABEL[family]) throw Errors.validation("Неизвестный раздел оборудования");
  const kind = input.kind ?? headKindOf(family);
  const stock = isStockKind(kind);

  // Складская позиция — остаток на складе, а не станок: категории и состояние не спрашиваем и не
  // принимаем, а ставим фиксированные (иначе в интерфейсе появились бы поля, которых там быть не
  // должно, а в счётчиках — «размотчик, требующий ремонта»).
  const categories = stock
    ? [...STOCK_CATEGORIES]
    : normalizeCategories(input.categories ?? []);
  assertCategorySet(categories);
  const model = trimTo(input.model, MAX_SHORT, "Модель");
  if (!model) throw Errors.validation("Укажите модель");

  const patch = await buildFields({ ...input, model, kind }, { categories, family, kind });
  const status = stock ? STOCK_STATUS : DEFAULT_MACHINE_STATUS;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const machine = await tx.machine.create({
        data: {
          ...patch,
          model,
          family,
          kind,
          categories,
          status,
          createdById: actor.id,
        },
        select: { id: true },
      });
      await tx.machineEvent.create({
        data: {
          machineId: machine.id,
          actorId: actor.id,
          kind: "created",
          toStatus: status,
        },
      });
      // Название снова в ходу — прятать подсказку не за чем (см. MachineModelSuppression).
      await tx.machineModelSuppression.deleteMany({
        where: { family, nameLower: model.toLowerCase() },
      });
      return machine;
    });
    return getMachine(created.id, actor);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw Errors.validation(duplicateNumberMessage(family, categories, input));
    }
    throw e;
  }
}

/** Набор категорий проверяется одним местом: и при заведении, и при смене (правила — в домене). */
function assertCategorySet(categories: readonly MachineCategory[]): void {
  if (categories.length === 0) throw Errors.validation("Выберите хотя бы одну категорию");
  if (categories.some((c) => !MACHINE_CATEGORY_LABEL[c])) {
    throw Errors.validation("Неизвестная категория");
  }
  if (!isValidCategorySet(categories)) {
    // Эксклюзивных в наборе может оказаться несколько — называем первую, этого достаточно,
    // чтобы человек понял, какая галочка мешает.
    const exclusive = categories.find(isExclusiveCategory);
    throw Errors.validation(
      exclusive
        ? `Категория «${MACHINE_CATEGORY_LABEL[exclusive]}» не совмещается с другими`
        : "Недопустимый набор категорий",
    );
  }
}

/**
 * Дубль номера ловится составным индексом (family, ourNumber) / (family, clientNumber) — говорим,
 * какой именно номер занят и в каком разделе. Это человеческая ошибка ввода при инвентаризации.
 */
function duplicateNumberMessage(
  family: EquipmentFamily,
  categories: readonly MachineCategory[],
  input: { ourNumber?: number | null; clientNumber?: number | null },
): string {
  const where = EQUIPMENT_FAMILY_LABEL[family].toLowerCase();
  const scheme = numberSchemeFor(categories);
  const value = scheme === "OUR" ? input.ourNumber : input.clientNumber;
  const label = formatNumberIn(scheme, value);
  return label
    ? `Номер ${label} уже занят в разделе «${where}»`
    : `Такой учётный номер уже занят в разделе «${where}»`;
}

export type ListParams = {
  /** Раздел: «Листогибы» или «Фальцепрокатники». Разделы не смешиваются нигде. */
  family?: EquipmentFamily;
  scope?: "active" | "archive";
  category?: MachineCategory;
  status?: MachineStatus;
  /** Вид оборудования внутри раздела. */
  kind?: EquipmentKind;
  /** Готовый фильтр-плитка из сводки. */
  flag?: "urgent" | "awaitingDiagnosis" | "notVerified" | "duePressing";
  q?: string;
  take?: number;
  skip?: number;
};

/**
 * Список + счётчики сводки. Активные (десятки) отдаются целиком — фильтрует и ищет клиент мгновенно.
 * Архив ищется и режется на странице сервером ТЕМ ЖЕ движком поиска, что и клиент: SQL-ILIKE не
 * умеет ни раскладку, ни «8≈+7», и два разных поиска неизбежно разошлись бы в ответах. Осознанная
 * граница: при 5–15 станках в неделю архив растёт на ~700 записей в год — выборка лёгкая
 * (select без текстов-простыней), к тому моменту, когда это станет дорого, модуль всё равно
 * переработают (этапы 2–3).
 */
export async function listMachines(params: ListParams, actor: Actor): Promise<MachineListResult> {
  assertMachineAccess(actor);
  const family: EquipmentFamily = params.family ?? "BENDER";
  const scope = params.scope === "archive" ? "archive" : "active";
  const archivedStatuses: MachineStatus[] = ["RELEASED", "SOLD", "VOIDED"];

  // Граница «на площадке / архив» и фильтр по состоянию складываются через AND, а НЕ перезаписывают
  // друг друга: раньше оба клали ключ `status` в один объект, и выбор состояния молча отменял
  // границу — «На площадке» + «Выдан клиенту» показывал архивные станки как активные.
  //
  // Складские позиции (размотчики/частотники) состояний не имеют и в архив не уходят: держим их в
  // области «на площадке» и убираем из архива, иначе фильтр по состоянию прятал бы весь склад.
  const stockKinds: EquipmentKind[] = ["UNCOILER", "INVERTER"];
  const archive = scope === "archive";
  const scopeFilter =
    scope === "archive"
      ? { status: { in: archivedStatuses }, kind: { notIn: stockKinds } }
      : { status: { notIn: archivedStatuses } };
  const where = {
    family,
    AND: [
      scopeFilter,
      ...(params.status ? [{ status: params.status, kind: { notIn: stockKinds } }] : []),
      // Категории — список, поэтому фильтр «has»: станок с двумя категориями показывается в обеих.
      ...(params.category
        ? [{ categories: { has: params.category }, kind: { notIn: stockKinds } }]
        : []),
      ...(params.kind ? [{ kind: params.kind }] : []),
    ],
  };

  const [rows, flagRows] = await Promise.all([
    prisma.machine.findMany({
      where,
      select: listSelect,
      // Порядок по учётному номеру, а НЕ по updatedAt (жалоба Артёма 15.08.2026: «при открытии
      // заявки она вылетает наверх»). Номер — число, поэтому 77-10 идёт после 77-9, а не между
      // 77-1 и 77-2, как было бы при строковой сортировке. Карточки без номера — в конце, между
      // собой по дате заведения. Группировку и направление выбирает клиент, порядок стабилен.
      //
      // Схемы нумерации идут блоками: сначала свой парк «77-N», следом клиентские «К-N» (у станка
      // заполнено ровно одно поле, поэтому сортировка по двум ключам подряд их и раскладывает).
      //
      // Архив — исключение: он грузится порциями по 30, и там ищут недавнее («куда делся станок,
      // который вчера выдали»), а не первый по номеру. Поэтому в архиве сверху свежие.
      orderBy: archive
        ? [{ updatedAt: "desc" as const }]
        : [
            { ourNumber: { sort: "asc" as const, nulls: "last" as const } },
            { clientNumber: { sort: "asc" as const, nulls: "last" as const } },
            { createdAt: "asc" as const },
          ],
    }),
    prisma.machine.findMany({ where: { family }, select: flagSelect }),
  ]);

  const summary = summarize(flagRows as FlaggableMachine[], new Date());

  let items = (rows as ListRow[]).map(toListItem);

  // Фильтр по плитке сводки — ТОЙ ЖЕ функцией, что считает счётчики (одна правда, не копия условий).
  if (params.flag) {
    const now = new Date();
    const flag = params.flag;
    const byId = new Map((rows as ListRow[]).map((r) => [r.id, r]));
    items = items.filter((item) => {
      const row = byId.get(item.id);
      return row ? machineFlags(row, now)[flag] : false;
    });
    // «Горит срок» смотрят, чтобы решить, за что хвататься — ближайший срок первым. У всех
    // прошедших фильтр dueDate заполнен (иначе флаг не горит); строки YYYY-MM-DD сравниваются лексикографически.
    if (flag === "duePressing") {
      items = [...items].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    }
  }

  const q = parseQuery(params.q ?? "");
  if (q.active) items = items.filter((m) => machineMatches(m, q));

  const total = items.length;
  // Потолка на take нет: «Показать ещё» в архиве наращивает окно, и жёсткий предел (500) молча
  // обрубал бы список на большом архиве — кнопка есть, а новые записи не приходят. Объём держит
  // сам архив: страница режется уже после фильтрации, в памяти, из выборки без тяжёлых полей.
  const take = Math.max(params.take ?? (scope === "archive" ? ARCHIVE_PAGE : total), 1);
  const skip = Math.max(params.skip ?? 0, 0);
  const page = scope === "archive" ? items.slice(skip, skip + take) : items;

  return {
    machines: page,
    summary,
    hasMore: scope === "archive" ? skip + page.length < total : false,
    total,
  };
}

/** Карточка станка: поля + фото + журнал. */
export async function getMachine(id: string, actor: Actor): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const m = await prisma.machine.findUnique({
    where: { id },
    select: {
      ...listSelect,
      voidReason: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      attachments: {
        select: { id: true, mimeType: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        select: {
          id: true,
          kind: true,
          fromStatus: true,
          toStatus: true,
          comment: true,
          changes: true,
          at: true,
          actor: { select: { name: true } },
        },
        orderBy: { at: "desc" },
      },
      // Заявки, по которым станок везли (21.08.2026, PRD §16.1): свежие сверху. Полей ровно
      // столько, сколько нужно строке блока «Заявки» — ни адреса, ни денег заявки здесь нет.
      taskLinks: {
        select: {
          direction: true,
          appliedAt: true,
          createdAt: true,
          task: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              scheduledDate: true,
              archivedAt: true,
              type: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!m) throw Errors.notFound();

  const base = toListItem({
    ...m,
    attachments: m.attachments.map((a) => ({ id: a.id })),
  } as ListRow);

  return {
    ...base,
    voidReason: m.voidReason,
    createdAt: m.createdAt.toISOString(),
    createdByName: m.createdBy?.name ?? null,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      createdAt: a.createdAt.toISOString(),
    })),
    events: m.events.map((e) => ({
      id: e.id,
      kind: e.kind,
      actorName: e.actor?.name ?? "—",
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      comment: e.comment,
      changes: Array.isArray(e.changes) ? (e.changes as unknown as MachineChange[]) : [],
      at: e.at.toISOString(),
    })),
    tasks: m.taskLinks.map((l) => ({
      taskId: l.task.id,
      taskNumber: l.task.number,
      title: l.task.title,
      typeName: l.task.type.name,
      status: l.task.status,
      scheduledDate: l.task.scheduledDate ? utcDateKey(l.task.scheduledDate) : null,
      archived: l.task.archivedAt !== null,
      direction: l.direction,
      appliedAt: l.appliedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

/** Правка полей карточки. Пишет в журнал «было→стало»; правка без изменений событие не создаёт. */
export async function editMachine(
  id: string,
  input: EditMachineInput,
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({ where: { id } });
  if (!before) throw Errors.notFound();

  const patch = await buildFields(input, {
    categories: before.categories,
    family: before.family,
    kind: before.kind,
  });
  const names = await namesFor([before.responsibleId, patch.responsibleId as string | null]);
  const changes = buildChanges(before as unknown as Record<string, unknown>, patch, names);
  if (changes.length === 0) return getMachine(id, actor);

  // Остаток нельзя опустить ниже того, что уже разобрано по комплектам: иначе склад показал бы
  // «свободно 0» при формально положительном количестве, а списание ушло бы в минус.
  if ("quantity" in patch && isStockKind(before.kind)) {
    const links = await prisma.machineKitPart.findMany({
      where: { partId: id },
      select: { qty: true, consumedAt: true },
    });
    const used = before.quantity - freeStock(before.quantity, links);
    const next = patch.quantity as number;
    if (next < used) {
      throw Errors.validation(`${used} шт уже стоят в комплектах — меньше указать нельзя`);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.machine.update({ where: { id }, data: patch });
      await tx.machineEvent.create({
        data: { machineId: id, actorId: actor.id, kind: "edit", changes },
      });
      // Переименовали карточку в это название — значит оно снова в ходу, подсказку возвращаем.
      if (typeof patch.model === "string") {
        await tx.machineModelSuppression.deleteMany({
          where: { family: before.family, nameLower: patch.model.toLowerCase() },
        });
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw Errors.validation(
        duplicateNumberMessage(before.family, before.categories, {
          ourNumber: patch.ourNumber as number | null,
          clientNumber: patch.clientNumber as number | null,
        }),
      );
    }
    throw e;
  }
  return getMachine(id, actor);
}

/**
 * Совместимость нового состояния с категориями — общая проверка changeStatus и sendShopTask.
 * Своё железо может дописать себе подходящую категорию само (`categoriesFollowingStatus`), и тогда
 * несовместимости нет; запрет остаётся там, где он про суть: чужой станок не продают и не сдают.
 */
function assertStatusAllowed(
  categories: readonly MachineCategory[],
  status: MachineStatus,
): void {
  if (!MACHINE_STATUS_LABEL[status]) throw Errors.validation("Неизвестное состояние");
  if (isRetiredStatus(status)) {
    throw Errors.validation(`Состояние «${MACHINE_STATUS_LABEL[status]}» больше не используется`);
  }
  if (
    !isStatusAllowedForCategories(categories, status) &&
    categoriesFollowingStatus(categories, status) === null
  ) {
    throw Errors.machineStatusCategory(
      `«${MACHINE_STATUS_LABEL[status]}» не подходит категориям «${categoriesLabel(categories)}»`,
    );
  }
}

/**
 * Запись смены состояния внутри транзакции — единая для changeStatus и sendShopTask, чтобы
 * семантика (voidReason, событие с «откуда→куда») не разъехалась между двумя путями.
 */
async function applyStatusChangeTx(
  tx: Prisma.TransactionClient,
  before: { id: string; status: MachineStatus; categories?: MachineCategory[] },
  toStatus: MachineStatus,
  reason: string | null,
  actorId: string,
): Promise<void> {
  // Своё железо дописывает себе подходящую категорию вслед за состоянием: на площадке «продали
  // арендный» — одно событие, а не смена категорий плюс смена состояния. Прежняя категория при
  // этом СОХРАНЯЕТСЯ (20.08.2026): станок вернётся из аренды и снова будет продаваться.
  const nextCategories =
    before.categories === undefined
      ? null
      : categoriesFollowingStatus(before.categories, toStatus);

  // Вернулся из аренды — диагностику и сверку нужно подтверждать заново: станок был у клиента,
  // и что с ним там стало, на площадке никто не видел. Ровно этот сброс зажигает баннер
  // обязательных отметок в карточке (src/domain/machine-flags.ts).
  const backFromRent = before.status === "RENTED" && !isArchivedStatus(toStatus);

  await tx.machine.update({
    where: { id: before.id },
    data: {
      status: toStatus,
      ...(nextCategories ? { categories: nextCategories } : {}),
      ...(backFromRent ? { diagnosedAt: null, lastVerifiedAt: null } : {}),
      // Причина аннулирования живёт на карточке (её показываем в архиве); при выходе из VOIDED — снимаем.
      voidReason: toStatus === "VOIDED" ? reason : null,
    },
  });
  await tx.machineEvent.create({
    data: {
      machineId: before.id,
      actorId,
      kind: "status_change",
      fromStatus: before.status,
      toStatus,
      comment: reason,
    },
  });
  // Смена категорий — отдельная строка журнала: иначе «почему станок стал арендным» пришлось бы
  // выводить из состояния, а журнал должен читаться как история.
  if (nextCategories && before.categories) {
    await tx.machineEvent.create({
      data: {
        machineId: before.id,
        actorId,
        kind: "edit",
        changes: [
          {
            field: "categories",
            label: "Категории",
            from: categoriesLabel(before.categories),
            to: categoriesLabel(nextCategories),
          },
        ],
      },
    });
  }
  if (backFromRent) {
    await tx.machineEvent.create({
      data: {
        machineId: before.id,
        actorId,
        kind: "comment",
        comment: "Вернулся из аренды — диагностику и сверку нужно отметить заново",
      },
    });
  }
}

/**
 * Смена состояния. Матрицы переходов нет (PRD §16.3) — проверяется совместимость с категорией
 * и обязательность причины для аннулирования. Возврат из архива разрешён: та же карточка живёт
 * дальше, история копится.
 */
export async function changeStatus(
  id: string,
  input: { status: MachineStatus; reason?: string | null; withKit?: boolean },
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, status: true, categories: true, kind: true },
  });
  if (!before) throw Errors.notFound();
  if (isStockKind(before.kind)) throw Errors.validation("У складских остатков состояния нет");
  if (!MACHINE_STATUS_LABEL[input.status]) throw Errors.validation("Неизвестное состояние");
  if (before.status === input.status) return getMachine(id, actor);

  assertStatusAllowed(before.categories, input.status);
  const reason = trimTo(input.reason, MAX_SHORT, "Причина");
  if (reasonRequiredFor(input.status) && !reason) {
    throw Errors.reasonRequired();
  }

  // Комплект едет вместе с головным (решение Артёма 15.08.2026) — но только по явной галочке:
  // молчаливый перенос состояния на чужие карточки человек бы не заметил.
  const kit = input.withKit === true ? await loadKitForTransfer(id, input.status) : [];

  await prisma.$transaction(async (tx) => {
    await applyStatusWithKitTx(tx, before, input.status, reason, actor.id, kit);
  });
  return getMachine(id, actor);
}

/**
 * Перевод головного станка вместе с комплектом внутри транзакции. Вынесено из `changeStatus`
 * (21.08.2026) без единого изменения поведения: тем же кодом теперь пользуется автоматика при
 * завершении заявки (task-machine-service). Две копии этой логики неизбежно разъехались бы —
 * а списание склада ошибок не прощает.
 *
 * `kit` заранее готовит `loadKitForTransfer` (чтение вне транзакции + проверка совместимости).
 */
export async function applyStatusWithKitTx(
  tx: Prisma.TransactionClient,
  before: { id: string; status: MachineStatus; categories?: MachineCategory[] },
  toStatus: MachineStatus,
  reason: string | null,
  actorId: string,
  kit: readonly TransferLink[],
): Promise<void> {
  await applyStatusChangeTx(tx, before, toStatus, reason, actorId);
  for (const link of kit) {
    if (link.stock) {
      // Продажа/выдача списывает штуки со склада один раз: consumedAt закрывает связь, поэтому
      // повторный перевод того же комплекта остаток больше не трогает.
      await tx.machine.update({
        where: { id: link.partId },
        data: { quantity: { decrement: link.qty } },
      });
      await tx.machineKitPart.update({
        where: { headId_partId: { headId: before.id, partId: link.partId } },
        data: { consumedAt: new Date() },
      });
      await tx.machineEvent.create({
        data: {
          machineId: link.partId,
          actorId,
          kind: "comment",
          comment: `Списано ${link.qty} шт в составе комплекта ${headLabel(link.head)} (${MACHINE_STATUS_LABEL[toStatus]})`,
        },
      });
      continue;
    }
    await applyStatusChangeTx(
      tx,
      { id: link.partId, status: link.partStatus, categories: link.partCategories },
      toStatus,
      reason,
      actorId,
    );
    await tx.machineEvent.create({
      data: {
        machineId: link.partId,
        actorId,
        kind: "comment",
        comment: `Состояние изменено вместе с комплектом ${headLabel(link.head)}`,
      },
    });
  }
}

type NumberedRef = { ourNumber: number | null; clientNumber: number | null };

/** Подпись станка в комментариях комплекта: его номер или нейтральное «станка». */
function headLabel(head: NumberedRef | null): string {
  return (head && formatMachineNumber(head)) ?? "станка";
}

/** Подпись комплектующей: «К-5 (ЛБМ 200)» или просто модель, если номера нет. */
function partLabel(part: NumberedRef & { model: string }): string {
  const number = formatMachineNumber(part);
  return number ? `${number} (${part.model})` : part.model;
}

export type TransferLink = {
  partId: string;
  qty: number;
  stock: boolean;
  partStatus: MachineStatus;
  /** Категории комплектующей — чтобы она переехала вслед за состоянием так же, как головной. */
  partCategories?: MachineCategory[];
  head: NumberedRef;
};

/**
 * Что поедет вместе с головным и можно ли вообще это сделать. Несовместимость проверяем ЗАРАНЕЕ и
 * говорим человеческим текстом: «продать вместе» арендный нож нельзя, и узнать об этом надо до
 * перевода, а не обнаружить потом половину переведённого комплекта.
 */
export async function loadKitForTransfer(headId: string, status: MachineStatus): Promise<TransferLink[]> {
  const head = await prisma.machine.findUnique({
    where: { id: headId },
    select: {
      ourNumber: true,
      clientNumber: true,
      kitParts: {
        where: { consumedAt: null },
        select: {
          qty: true,
          part: {
            select: {
              id: true,
              ourNumber: true,
              clientNumber: true,
              kind: true,
              model: true,
              status: true,
              categories: true,
            },
          },
        },
      },
    },
  });
  if (!head) throw Errors.notFound();

  const out: TransferLink[] = [];
  for (const link of head.kitParts) {
    const stock = isStockKind(link.part.kind);
    if (stock) {
      if (!consumesStock(status)) continue; // аренда и ремонт остаток не трогают — он уже занят
      out.push({
        partId: link.part.id,
        qty: link.qty,
        stock: true,
        partStatus: link.part.status,
        head,
      });
      continue;
    }
    if (!transfersStatus(status) || link.part.status === status) continue;
    // Своя комплектующая переезжает в подходящую категорию вместе с головным (комплект продают
    // целиком). Чужая — нет: клиентский нож нельзя продать вместе с нашим станком.
    if (
      !isStatusAllowedForCategories(link.part.categories, status) &&
      categoriesFollowingStatus(link.part.categories, status) === null
    ) {
      const name = formatMachineNumber(link.part) ?? link.part.model;
      throw Errors.machineStatusCategory(
        `«${MACHINE_STATUS_LABEL[status]}» не подходит комплектующей ${name} (${categoriesLabel(link.part.categories)}) — смените её категории или снимите галочку`,
      );
    }
    out.push({
      partId: link.part.id,
      qty: link.qty,
      stock: false,
      partStatus: link.part.status,
      partCategories: link.part.categories,
      head,
    });
  }
  return out;
}

// ───────────────────────────────── комплект ─────────────────────────────────

/**
 * Добавить комплектующую к станку. Повторный вызов с тем же partId — правка количества (складские
 * позиции), а не ошибка: человек уточняет, сколько штук уедет.
 */
export async function attachKitPart(
  headId: string,
  input: { partId: string; qty?: number },
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const partId = typeof input.partId === "string" ? input.partId.trim() : "";
  if (!partId) throw Errors.validation("Выберите комплектующую");

  const [head, part] = await Promise.all([
    prisma.machine.findUnique({
      where: { id: headId },
      select: {
        id: true,
        family: true,
        kind: true,
        quantity: true,
        ourNumber: true,
        clientNumber: true,
      },
    }),
    prisma.machine.findUnique({
      where: { id: partId },
      select: {
        id: true,
        family: true,
        kind: true,
        quantity: true,
        ourNumber: true,
        clientNumber: true,
        model: true,
      },
    }),
  ]);
  if (!head) throw Errors.notFound();
  if (!part) throw Errors.validation("Комплектующая не найдена");

  const qty = input.qty ?? 1;
  // Связь с ЭТИМ же головным из проверки остатка исключаем: иначе правка количества сравнивалась бы
  // сама с собой и «3 → 4» падало бы на полностью разобранном остатке.
  const otherLinks: KitLink[] = await prisma.machineKitPart.findMany({
    where: { partId, NOT: { headId } },
    select: { qty: true, consumedAt: true },
  });
  assertAttachable(head, part, qty, otherLinks);

  const label = partLabel(part);
  await prisma.$transaction(async (tx) => {
    await tx.machineKitPart.upsert({
      where: { headId_partId: { headId, partId } },
      create: { headId, partId, qty },
      update: { qty, consumedAt: null },
    });
    await tx.machineEvent.create({
      data: {
        machineId: headId,
        actorId: actor.id,
        kind: "comment",
        comment: isStockKind(part.kind)
          ? `В комплект добавлено: ${label} — ${qty} шт`
          : `В комплект добавлено: ${label}`,
      },
    });
    await tx.machineEvent.create({
      data: {
        machineId: partId,
        actorId: actor.id,
        kind: "comment",
        comment: `Поставлено в комплект ${headLabel(head)}`,
      },
    });
  });
  return getMachine(headId, actor);
}

/** Убрать комплектующую из комплекта. Списанные связи (проданный комплект) — часть истории, их не трогаем. */
export async function detachKitPart(
  headId: string,
  partId: string,
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const link = await prisma.machineKitPart.findUnique({
    where: { headId_partId: { headId, partId } },
    select: {
      consumedAt: true,
      head: { select: { ourNumber: true, clientNumber: true } },
      part: { select: { ourNumber: true, clientNumber: true, model: true } },
    },
  });
  if (!link) throw Errors.notFound();
  if (link.consumedAt !== null) {
    throw Errors.validation("Этот комплект уже уехал — связь остаётся в истории");
  }

  const label = partLabel(link.part);
  await prisma.$transaction(async (tx) => {
    await tx.machineKitPart.delete({ where: { headId_partId: { headId, partId } } });
    await tx.machineEvent.create({
      data: {
        machineId: headId,
        actorId: actor.id,
        kind: "comment",
        comment: `Из комплекта убрано: ${label}`,
      },
    });
    await tx.machineEvent.create({
      data: {
        machineId: partId,
        actorId: actor.id,
        kind: "comment",
        comment: `Убрано из комплекта ${headLabel(link.head)}`,
      },
    });
  });
  return getMachine(headId, actor);
}

/**
 * Комплектующие раздела, которые можно добавить в комплект: свободные ножи и складские позиции с
 * ненулевым остатком. Головные станки и архив сюда не попадают.
 */
export async function listKitCandidates(
  headId: string,
  actor: Actor,
): Promise<
  {
    id: string;
    ourNumber: number | null;
    clientNumber: number | null;
    kind: EquipmentKind;
    model: string;
    free: number;
  }[]
> {
  assertMachineAccess(actor);
  const head = await prisma.machine.findUnique({
    where: { id: headId },
    select: { family: true, kind: true },
  });
  if (!head) throw Errors.notFound();
  if (!isHeadKind(head.kind)) return [];

  const rows = await prisma.machine.findMany({
    where: {
      family: head.family,
      kind: { notIn: ["MACHINE", "SEAMER"] },
      status: { notIn: ["RELEASED", "SOLD", "VOIDED"] },
    },
    select: {
      id: true,
      ourNumber: true,
      clientNumber: true,
      kind: true,
      model: true,
      quantity: true,
      kitOf: { select: { qty: true, consumedAt: true, headId: true } },
    },
    orderBy: [{ ourNumber: { sort: "asc", nulls: "last" } }, { model: "asc" }],
  });

  return rows
    .map((r) => {
      const links = r.kitOf.filter((l) => l.headId !== headId);
      const free = isStockKind(r.kind)
        ? freeStock(r.quantity, links)
        : links.some((l) => l.consumedAt === null)
          ? 0
          : 1;
      return {
        id: r.id,
        ourNumber: r.ourNumber,
        clientNumber: r.clientNumber,
        kind: r.kind,
        model: r.model,
        free,
      };
    })
    .filter((r) => r.free > 0);
}

/**
 * Смена набора категорий (20.08.2026: галочки вместо одного выбора). Приходит ПОЛНЫЙ набор, а не
 * «включить/выключить одну»: так проверка комбинации и перенумерация делаются один раз и атомарно,
 * без промежуточных состояний вроде «ни одной категории» между двумя запросами.
 */
export async function changeCategories(
  id: string,
  input: { categories: MachineCategory[] },
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      categories: true,
      ourNumber: true,
      clientNumber: true,
      kind: true,
      family: true,
    },
  });
  if (!before) throw Errors.notFound();
  if (isStockKind(before.kind)) throw Errors.validation("У складских остатков категорий нет");

  const next = normalizeCategories(input.categories ?? []);
  assertCategorySet(next);
  const current = normalizeCategories(before.categories);
  if (next.join("|") === current.join("|")) return getMachine(id, actor);

  if (!isStatusAllowedForCategories(next, before.status)) {
    throw Errors.machineStatusCategory(
      `Сначала смените состояние: «${MACHINE_STATUS_LABEL[before.status]}» не бывает у категорий «${categoriesLabel(next)}»`,
    );
  }

  // Номер следует за категориями (решение Артёма 15.08.2026, вечер): станок переехал из своего парка
  // в клиентские — «77-N» с него снимается, и он получает следующий свободный «К-N». Внутри одной
  // схемы (продажа ↔ аренда, в том числе обе сразу) номер остаётся: это то же железо того же парка.
  const renumber = await planRenumber(before, next);

  const names = new Map<string, string>();
  const changes = buildChanges(
    { categories: current, ourNumber: before.ourNumber, clientNumber: before.clientNumber },
    { categories: next, ...renumber },
    names,
  );

  await prisma.$transaction(async (tx) => {
    await tx.machine.update({
      where: { id },
      data: { categories: next, ...renumber },
    });
    await tx.machineEvent.create({
      data: { machineId: id, actorId: actor.id, kind: "edit", changes },
    });
  });
  return getMachine(id, actor);
}

/**
 * Что станет с номером при переезде в другую категорию: пусто — если схема та же (продажа ↔ аренда),
 * иначе освобождаем старое поле и выдаём следующий свободный номер новой схемы.
 *
 * Карточка без номера номер и не получает: незаполненный номер — осознанное состояние (станок ещё не
 * маркирован), и выдавать его молча при смене категории значило бы придумать за человека.
 */
async function planRenumber(
  before: {
    family: EquipmentFamily;
    categories: MachineCategory[];
    ourNumber: number | null;
    clientNumber: number | null;
  },
  next: readonly MachineCategory[],
): Promise<{ ourNumber?: number | null; clientNumber?: number | null }> {
  const from = numberSchemeFor(before.categories);
  const to = numberSchemeFor(next);
  if (from === to) return {};

  const had = from === "OUR" ? before.ourNumber : before.clientNumber;
  if (had === null) return {};

  const free = await nextFreeNumber(before.family, to);
  return to === "OUR"
    ? { ourNumber: free, clientNumber: null }
    : { clientNumber: free, ourNumber: null };
}

/** Отметка «Диагностика проведена» / «Подтверждён на месте» — снимает соответствующий индикатор. */
export async function markChecked(
  id: string,
  op: "diagnosed" | "verified",
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const exists = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw Errors.notFound();

  const now = new Date();
  const label = op === "diagnosed" ? "Диагностика проведена" : "Подтверждён на месте";
  await prisma.$transaction(async (tx) => {
    await tx.machine.update({
      where: { id },
      data: op === "diagnosed" ? { diagnosedAt: now } : { lastVerifiedAt: now },
    });
    await tx.machineEvent.create({
      data: { machineId: id, actorId: actor.id, kind: "comment", comment: label },
    });
  });
  return getMachine(id, actor);
}

/**
 * «Задание в цех»: фиксирует полный текст задания событием kind=shop_task (текст собирается из
 * карточки + комментария «что сделать» и уходит в Telegram-группу руками Максима — цех вне
 * системы, PRD §16.6) и, по флагу, той же транзакцией переводит станок «В ремонте».
 */
export async function sendShopTask(
  id: string,
  input: { note?: string | null; toInRepair?: boolean },
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({ where: { id } });
  if (!before) throw Errors.notFound();

  const note = trimTo(input.note, MAX_TEXT, "Комментарий для цеха");
  const text = buildShopTaskText(before, note);
  // Составной текст может вылезти за потолок события из-за длинной дефектовки — говорим честно,
  // а не обрезаем молча (правило trimTo).
  if (text.length > MAX_TEXT) {
    throw Errors.validation(
      `Задание получилось длиннее ${MAX_TEXT} символов — сократите комментарий или дефектовку`,
    );
  }

  const toInRepair = input.toInRepair === true && before.status !== "IN_REPAIR";
  if (toInRepair) assertStatusAllowed(before.categories, "IN_REPAIR");

  await prisma.$transaction(async (tx) => {
    await tx.machineEvent.create({
      data: { machineId: id, actorId: actor.id, kind: "shop_task", comment: text },
    });
    if (toInRepair) await applyStatusChangeTx(tx, before, "IN_REPAIR", null, actor.id);
  });
  return getMachine(id, actor);
}

/** Комментарий в журнал станка. */
export async function addComment(id: string, text: string, actor: Actor): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const comment = trimTo(text, MAX_TEXT, "Комментарий");
  if (!comment) throw Errors.validation("Пустой комментарий");
  const exists = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw Errors.notFound();

  await prisma.machineEvent.create({
    data: { machineId: id, actorId: actor.id, kind: "comment", comment },
  });
  return getMachine(id, actor);
}

/** Следующий свободный номер схемы в разделе. Нумерация не сквозная — своя в каждом разделе. */
async function nextFreeNumber(family: EquipmentFamily, scheme: NumberScheme): Promise<number> {
  const max = await prisma.machine.aggregate({
    where: { family },
    _max: { ourNumber: true, clientNumber: true },
  });
  const last = scheme === "OUR" ? max._max.ourNumber : max._max.clientNumber;
  return (last ?? 0) + 1;
}

/**
 * Подсказки следующего свободного номера для формы — сразу по обеим схемам: категорию в форме ещё
 * переключают, и подсказка обязана меняться вместе с ней, без второго запроса.
 */
export async function nextNumbers(
  actor: Actor,
  family: EquipmentFamily = "BENDER",
): Promise<{ ourNumber: number; clientNumber: number }> {
  assertMachineAccess(actor);
  const [ourNumber, clientNumber] = await Promise.all([
    nextFreeNumber(family, "OUR"),
    nextFreeNumber(family, "CLIENT"),
  ]);
  return { ourNumber, clientNumber };
}

/** Сотрудники офиса, которых можно назначить ответственными (Милена/Максим/Михаил/Артём). */
export async function listResponsibles(actor: Actor): Promise<{ id: string; name: string }[]> {
  assertMachineAccess(actor);
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "DISPATCHER", "SERVICE_MANAGER"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Реально введённые модели (по всей картотеке, включая архив) — сырьё для подсказок формы.
 * Пул «базовый справочник + эти значения» собирает клиент (src/domain/machine-models.ts).
 */
export async function listKnownModels(
  actor: Actor,
  family: EquipmentFamily = "BENDER",
): Promise<string[]> {
  assertMachineAccess(actor);
  // Модели берём по разделу: подсказывать «Sorex LBM 200» при заведении частотника — шум.
  const rows = await prisma.machine.findMany({
    where: { family },
    select: { model: true },
    distinct: ["model"],
    orderBy: { model: "asc" },
  });
  return rows.map((r) => r.model).filter((m) => m.trim().length > 0);
}

/**
 * Скрытые подсказки моделей раздела (20.08.2026). Возвращаем в нижнем регистре: сравнение имён
 * везде регистронезависимое, и приводить их к одному виду должен один слой, а не каждый вызов.
 */
export async function listSuppressedModels(
  actor: Actor,
  family: EquipmentFamily = "BENDER",
): Promise<string[]> {
  assertMachineAccess(actor);
  const rows = await prisma.machineModelSuppression.findMany({
    where: { family },
    select: { nameLower: true },
  });
  return rows.map((r) => r.nameLower);
}

/**
 * Скрыть подсказку модели. Идемпотентно (upsert): повторный крестик по той же строке — не ошибка,
 * человек мог не заметить, что подсказка уже убрана на другом устройстве.
 *
 * Карточки с этим названием НЕ меняются: прячется подсказка, а не данные.
 */
export async function suppressModel(
  actor: Actor,
  family: EquipmentFamily,
  name: string,
): Promise<void> {
  assertMachineAccess(actor);
  const value = trimTo(name, MAX_SHORT, "Модель");
  if (!value) throw Errors.validation("Укажите модель");
  const nameLower = value.toLowerCase();
  await prisma.machineModelSuppression.upsert({
    where: { family_nameLower: { family, nameLower } },
    create: { family, nameLower, createdById: actor.id },
    update: {},
  });
}

/** Вернуть скрытую подсказку. Тоже идемпотентно: снимать нечего — значит, уже как надо. */
export async function unsuppressModel(
  actor: Actor,
  family: EquipmentFamily,
  name: string,
): Promise<void> {
  assertMachineAccess(actor);
  const value = trimTo(name, MAX_SHORT, "Модель");
  if (!value) throw Errors.validation("Укажите модель");
  await prisma.machineModelSuppression.deleteMany({
    where: { family, nameLower: value.toLowerCase() },
  });
}

export { isArchivedStatus };
