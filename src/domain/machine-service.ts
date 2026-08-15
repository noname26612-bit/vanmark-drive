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
  isArchivedStatus,
  isStatusAllowedForCategory,
  isKindInFamily,
  isStockKind,
  isHeadKind,
  headKindOf,
  reasonRequiredFor,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_FAMILY_LABEL,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
  STOCK_CATEGORY,
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

const MAX_TEXT = 2000; // потолок на длинные текстовые поля (дефектовка/заметки)
const MAX_SHORT = 200; // потолок на короткие поля (модель, место, контакт…)
const CHANGE_VALUE_MAX = 120; // сколько символа значения храним в «было→стало» (журнал не архив текстов)
const ARCHIVE_PAGE = 30;

// ───────────────────────────────── вход ─────────────────────────────────

export type MachineFields = {
  ourNumber: number | null;
  kind: EquipmentKind;
  /** Остаток на складе — принимается только у складских видов (размотчик, частотник). */
  quantity: number;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  serialNumber: string | null;
  orgName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  invoice1C: string | null;
  responsibleId: string | null;
  deliveredBy: string | null;
  arrivedAt: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD — срок готовности/выдачи
  isUrgent: boolean;
  defectNotes: string | null;
  location: string | null;
  notes: string | null;
};

/**
 * Создание: обязательны ТОЛЬКО категория и модель (PRD §16.4) — инвентаризацию нельзя блокировать.
 * family приходит из раздела, в котором открыт экран, и потом не меняется: перенос карточки между
 * «Листогибами» и «Фальцепрокатниками» — это заведомо ошибка ввода, её лечат аннулированием.
 */
export type CreateMachineInput = Partial<MachineFields> & {
  category: MachineCategory;
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
      part: { select: { id: true, ourNumber: true, kind: true, model: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  kitOf: {
    select: {
      qty: true,
      consumedAt: true,
      head: { select: { id: true, ourNumber: true, model: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

const listSelect = {
  id: true,
  number: true,
  ourNumber: true,
  family: true,
  kind: true,
  quantity: true,
  category: true,
  status: true,
  model: true,
  configuration: true,
  metalThickness: true,
  serialNumber: true,
  orgName: true,
  contactName: true,
  contactPhone: true,
  invoice1C: true,
  location: true,
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
  category: true,
  status: true,
  invoice1C: true,
  isUrgent: true,
  arrivedAt: true,
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
    kind: EquipmentKind;
    model: string;
    status: MachineStatus;
  };
};

type KitHeadRow = {
  qty: number;
  consumedAt: Date | null;
  head: { id: string; ourNumber: number | null; model: string };
};

type ListRow = {
  id: string;
  number: number;
  ourNumber: number | null;
  family: EquipmentFamily;
  kind: EquipmentKind;
  quantity: number;
  category: MachineCategory;
  status: MachineStatus;
  model: string;
  configuration: string | null;
  metalThickness: string | null;
  serialNumber: string | null;
  orgName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  invoice1C: string | null;
  location: string | null;
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
    kind: r.part.kind,
    model: r.part.model,
    status: r.part.status,
    qty: r.qty,
    consumedAt: r.consumedAt?.toISOString() ?? null,
  };
}

function toKitHead(r: KitHeadRow): KitHeadView {
  return { id: r.head.id, ourNumber: r.head.ourNumber, model: r.head.model, qty: r.qty };
}

function toListItem(m: ListRow): MachineListItem {
  const kitOf: KitLink[] = m.kitOf.map((r) => ({ qty: r.qty, consumedAt: r.consumedAt }));
  return {
    id: m.id,
    number: m.number,
    ourNumber: m.ourNumber,
    family: m.family,
    kind: m.kind,
    quantity: m.quantity,
    // Свободный остаток осмыслен только у складских позиций; у штучного оборудования это всегда 1
    // (иначе строка списка показывала бы «свободно 0» у ножа, стоящего в комплекте, — а он не склад).
    freeQuantity: isStockKind(m.kind) ? freeStock(m.quantity, kitOf) : m.quantity,
    kitParts: m.kitParts.map(toKitPart),
    kitHeads: m.kitOf.map(toKitHead),
    category: m.category,
    status: m.status,
    model: m.model,
    configuration: m.configuration,
    metalThickness: m.metalThickness,
    serialNumber: m.serialNumber,
    orgName: m.orgName,
    contactName: m.contactName,
    contactPhone: m.contactPhone,
    invoice1C: m.invoice1C,
    location: m.location,
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
  ["serialNumber", "Серийный номер"],
  ["orgName", "Заказчик"],
  ["contactName", "Контакт"],
  ["contactPhone", "Телефон"],
  ["invoice1C", "№ заказа 1С"],
  ["deliveredBy", "Кто привёз"],
  ["location", "Место на площадке"],
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
  ctx: { category: MachineCategory; family: EquipmentFamily; kind: EquipmentKind },
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

  if ("ourNumber" in input) {
    const raw = input.ourNumber;
    if (raw === null || raw === undefined) {
      patch.ourNumber = null;
    } else {
      if (!Number.isInteger(raw) || raw < 1 || raw > 100_000) {
        throw Errors.validation("Учётный номер — целое число больше нуля");
      }
      // С 15.08.2026 номер доступен ЛЮБОЙ категории, включая клиентскую (решение Артёма): системный
      // сквозной номер убран из интерфейса, и учётный «77-N» остался единственной подписью карточки.
      patch.ourNumber = raw;
    }
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
const TRACKED: { field: keyof MachineFields | "category"; label: string }[] = [
  { field: "kind", label: "Вид" },
  { field: "category", label: "Категория" },
  { field: "location", label: "Место на площадке" },
  { field: "responsibleId", label: "Ответственный" },
  { field: "ourNumber", label: "Наш номер" },
  { field: "model", label: "Модель" },
  { field: "configuration", label: "Комплектация" },
  { field: "metalThickness", label: "Толщина металла" },
  { field: "serialNumber", label: "Серийный номер" },
  { field: "orgName", label: "Заказчик" },
  { field: "contactName", label: "Контакт" },
  { field: "contactPhone", label: "Телефон" },
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
  if (field === "category") return MACHINE_CATEGORY_LABEL[value as MachineCategory];
  if (field === "responsibleId") return names.get(String(value)) ?? "—";
  if (field === "ourNumber") return `77-${String(value)}`;
  if (field === "isUrgent") return value === true ? "да" : "нет";
  if (value instanceof Date) {
    const [y, m, d] = utcDateKey(value).split("-");
    return `${d}.${m}.${y}`;
  }
  const s = String(value);
  if (!s.trim()) return null;
  return s.length > CHANGE_VALUE_MAX ? `${s.slice(0, CHANGE_VALUE_MAX)}…` : s;
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
    const fromKey = from instanceof Date ? from.getTime() : from;
    const toKey = to instanceof Date ? to.getTime() : to;
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

  // Складская позиция — остаток на складе, а не станок: категорию и состояние не спрашиваем и не
  // принимаем, а ставим фиксированные (иначе в интерфейсе появились бы поля, которых там быть не
  // должно, а в счётчиках — «размотчик, требующий ремонта»).
  const category = stock ? STOCK_CATEGORY : input.category;
  if (!category || !MACHINE_CATEGORY_LABEL[category]) {
    throw Errors.validation("Выберите категорию станка");
  }
  const model = trimTo(input.model, MAX_SHORT, "Модель");
  if (!model) throw Errors.validation("Укажите модель");

  const patch = await buildFields({ ...input, model, kind }, { category, family, kind });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const machine = await tx.machine.create({
        data: {
          ...patch,
          model,
          family,
          kind,
          category,
          ...(stock ? { status: STOCK_STATUS } : {}),
          createdById: actor.id,
        },
        select: { id: true },
      });
      await tx.machineEvent.create({
        data: {
          machineId: machine.id,
          actorId: actor.id,
          kind: "created",
          toStatus: stock ? STOCK_STATUS : "ACCEPTED",
        },
      });
      return machine;
    });
    return getMachine(created.id, actor);
  } catch (e) {
    if (isUniqueViolation(e)) throw Errors.validation(duplicateNumberMessage(family, input.ourNumber));
    throw e;
  }
}

/** Дубль «77-N» ловится составным индексом (family, ourNumber) — говорим, в каком разделе занят. */
function duplicateNumberMessage(family: EquipmentFamily, ourNumber: number | null | undefined): string {
  const where = EQUIPMENT_FAMILY_LABEL[family].toLowerCase();
  return ourNumber
    ? `Номер 77-${ourNumber} уже занят в разделе «${where}»`
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
  flag?: "noInvoice1C" | "urgent" | "awaitingDiagnosis" | "staleVerification" | "duePressing";
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
  const scopeFilter =
    scope === "archive"
      ? { status: { in: archivedStatuses }, kind: { notIn: stockKinds } }
      : { status: { notIn: archivedStatuses } };
  const where = {
    family,
    AND: [
      scopeFilter,
      ...(params.status ? [{ status: params.status, kind: { notIn: stockKinds } }] : []),
      ...(params.category ? [{ category: params.category, kind: { notIn: stockKinds } }] : []),
      ...(params.kind ? [{ kind: params.kind }] : []),
    ],
  };

  const [rows, flagRows, locationRows] = await Promise.all([
    prisma.machine.findMany({
      where,
      select: listSelect,
      // Порядок по учётному номеру, а НЕ по updatedAt (жалоба Артёма 15.08.2026: «при открытии
      // заявки она вылетает наверх»). Номер — число, поэтому 77-10 идёт после 77-9, а не между
      // 77-1 и 77-2, как было бы при строковой сортировке. Карточки без номера — в конце, между
      // собой по дате заведения. Группировку и направление выбирает клиент, порядок стабилен.
      orderBy: [{ ourNumber: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
    prisma.machine.findMany({ where: { family }, select: flagSelect }),
    prisma.machine.findMany({
      where: { family, location: { not: null } },
      select: { location: true },
      distinct: ["location"],
      orderBy: { location: "asc" },
    }),
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
    locations: locationRows
      .map((r) => r.location)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
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
    category: before.category,
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
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw Errors.validation(duplicateNumberMessage(before.family, patch.ourNumber as number | null));
    }
    throw e;
  }
  return getMachine(id, actor);
}

/** Совместимость нового состояния с категорией — общая проверка changeStatus и sendShopTask. */
function assertStatusAllowed(category: MachineCategory, status: MachineStatus): void {
  if (!MACHINE_STATUS_LABEL[status]) throw Errors.validation("Неизвестное состояние");
  if (!isStatusAllowedForCategory(category, status)) {
    throw Errors.machineStatusCategory(
      `«${MACHINE_STATUS_LABEL[status]}» не подходит категории «${MACHINE_CATEGORY_LABEL[category]}»`,
    );
  }
}

/**
 * Запись смены состояния внутри транзакции — единая для changeStatus и sendShopTask, чтобы
 * семантика (voidReason, событие с «откуда→куда») не разъехалась между двумя путями.
 */
async function applyStatusChangeTx(
  tx: Prisma.TransactionClient,
  before: { id: string; status: MachineStatus },
  toStatus: MachineStatus,
  reason: string | null,
  actorId: string,
): Promise<void> {
  await tx.machine.update({
    where: { id: before.id },
    data: {
      status: toStatus,
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
    select: { id: true, status: true, category: true, kind: true },
  });
  if (!before) throw Errors.notFound();
  if (isStockKind(before.kind)) throw Errors.validation("У складских остатков состояния нет");
  if (!MACHINE_STATUS_LABEL[input.status]) throw Errors.validation("Неизвестное состояние");
  if (before.status === input.status) return getMachine(id, actor);

  assertStatusAllowed(before.category, input.status);
  const reason = trimTo(input.reason, MAX_SHORT, "Причина");
  if (reasonRequiredFor(input.status) && !reason) {
    throw Errors.reasonRequired();
  }

  // Комплект едет вместе с головным (решение Артёма 15.08.2026) — но только по явной галочке:
  // молчаливый перенос состояния на чужие карточки человек бы не заметил.
  const kit = input.withKit === true ? await loadKitForTransfer(id, input.status) : [];

  await prisma.$transaction(async (tx) => {
    await applyStatusChangeTx(tx, before, input.status, reason, actor.id);
    for (const link of kit) {
      if (link.stock) {
        // Продажа/выдача списывает штуки со склада один раз: consumedAt закрывает связь, поэтому
        // повторный перевод того же комплекта остаток больше не трогает.
        await tx.machine.update({
          where: { id: link.partId },
          data: { quantity: { decrement: link.qty } },
        });
        await tx.machineKitPart.update({
          where: { headId_partId: { headId: id, partId: link.partId } },
          data: { consumedAt: new Date() },
        });
        await tx.machineEvent.create({
          data: {
            machineId: link.partId,
            actorId: actor.id,
            kind: "comment",
            comment: `Списано ${link.qty} шт в составе комплекта ${headLabel(link.headOurNumber)} (${MACHINE_STATUS_LABEL[input.status]})`,
          },
        });
        continue;
      }
      await applyStatusChangeTx(
        tx,
        { id: link.partId, status: link.partStatus },
        input.status,
        reason,
        actor.id,
      );
      await tx.machineEvent.create({
        data: {
          machineId: link.partId,
          actorId: actor.id,
          kind: "comment",
          comment: `Состояние изменено вместе с комплектом ${headLabel(link.headOurNumber)}`,
        },
      });
    }
  });
  return getMachine(id, actor);
}

function headLabel(ourNumber: number | null): string {
  return ourNumber === null ? "станка" : `77-${ourNumber}`;
}

type TransferLink = {
  partId: string;
  qty: number;
  stock: boolean;
  partStatus: MachineStatus;
  headOurNumber: number | null;
};

/**
 * Что поедет вместе с головным и можно ли вообще это сделать. Несовместимость проверяем ЗАРАНЕЕ и
 * говорим человеческим текстом: «продать вместе» арендный нож нельзя, и узнать об этом надо до
 * перевода, а не обнаружить потом половину переведённого комплекта.
 */
async function loadKitForTransfer(headId: string, status: MachineStatus): Promise<TransferLink[]> {
  const head = await prisma.machine.findUnique({
    where: { id: headId },
    select: {
      ourNumber: true,
      kitParts: {
        where: { consumedAt: null },
        select: {
          qty: true,
          part: {
            select: { id: true, ourNumber: true, kind: true, model: true, status: true, category: true },
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
      out.push({ partId: link.part.id, qty: link.qty, stock: true, partStatus: link.part.status, headOurNumber: head.ourNumber });
      continue;
    }
    if (!transfersStatus(status) || link.part.status === status) continue;
    if (!isStatusAllowedForCategory(link.part.category, status)) {
      const name = link.part.ourNumber ? `77-${link.part.ourNumber}` : link.part.model;
      throw Errors.machineStatusCategory(
        `«${MACHINE_STATUS_LABEL[status]}» не подходит комплектующей ${name} (${MACHINE_CATEGORY_LABEL[link.part.category]}) — смените её категорию или снимите галочку`,
      );
    }
    out.push({
      partId: link.part.id,
      qty: link.qty,
      stock: false,
      partStatus: link.part.status,
      headOurNumber: head.ourNumber,
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
      select: { id: true, family: true, kind: true, quantity: true, ourNumber: true },
    }),
    prisma.machine.findUnique({
      where: { id: partId },
      select: { id: true, family: true, kind: true, quantity: true, ourNumber: true, model: true },
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

  const label = part.ourNumber ? `77-${part.ourNumber} (${part.model})` : part.model;
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
        comment: `Поставлено в комплект ${headLabel(head.ourNumber)}`,
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
      head: { select: { ourNumber: true } },
      part: { select: { ourNumber: true, model: true } },
    },
  });
  if (!link) throw Errors.notFound();
  if (link.consumedAt !== null) {
    throw Errors.validation("Этот комплект уже уехал — связь остаётся в истории");
  }

  const label = link.part.ourNumber ? `77-${link.part.ourNumber} (${link.part.model})` : link.part.model;
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
        comment: `Убрано из комплекта ${headLabel(link.head.ourNumber)}`,
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
): Promise<{ id: string; ourNumber: number | null; kind: EquipmentKind; model: string; free: number }[]> {
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
      return { id: r.id, ourNumber: r.ourNumber, kind: r.kind, model: r.model, free };
    })
    .filter((r) => r.free > 0);
}

/** Смена категории. Текущее состояние обязано остаться совместимым (нельзя «в аренде» у продажного). */
export async function changeCategory(
  id: string,
  input: { category: MachineCategory },
  actor: Actor,
): Promise<MachineDetail> {
  assertMachineAccess(actor);
  const before = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, status: true, category: true, ourNumber: true, kind: true },
  });
  if (!before) throw Errors.notFound();
  if (!MACHINE_CATEGORY_LABEL[input.category]) throw Errors.validation("Неизвестная категория");
  if (isStockKind(before.kind)) throw Errors.validation("У складских остатков категории нет");
  if (before.category === input.category) return getMachine(id, actor);

  if (!isStatusAllowedForCategory(input.category, before.status)) {
    throw Errors.machineStatusCategory(
      `Сначала смените состояние: «${MACHINE_STATUS_LABEL[before.status]}» не бывает у категории «${MACHINE_CATEGORY_LABEL[input.category]}»`,
    );
  }
  // Прежнее требование «снимите 77-N при переводе в клиентские» снято 15.08.2026: учётный номер
  // теперь ведут у любой категории — он единственная подпись карточки после того, как системный
  // сквозной номер убрали из интерфейса.

  const names = new Map<string, string>();
  const changes = buildChanges(
    { category: before.category },
    { category: input.category },
    names,
  );

  await prisma.$transaction(async (tx) => {
    await tx.machine.update({
      where: { id },
      data: { category: input.category },
    });
    await tx.machineEvent.create({
      data: { machineId: id, actorId: actor.id, kind: "edit", changes },
    });
  });
  return getMachine(id, actor);
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
  if (toInRepair) assertStatusAllowed(before.category, "IN_REPAIR");

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

/** Подсказка следующего свободного «77-N» — своя в каждом разделе (нумерация не сквозная). */
export async function nextOurNumber(actor: Actor, family: EquipmentFamily = "BENDER"): Promise<number> {
  assertMachineAccess(actor);
  const max = await prisma.machine.aggregate({ where: { family }, _max: { ourNumber: true } });
  return (max._max.ourNumber ?? 0) + 1;
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

export { isArchivedStatus };
