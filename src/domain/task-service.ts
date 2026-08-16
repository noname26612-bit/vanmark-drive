// Доменный сервис задач: создание (с авто-номером), назначение, переходы по матрице,
// перенос, комментарии, чтения. Вся логика и проверки прав — здесь (ARCHITECTURE §3).
// Каждое изменение атомарно пишет событие в TaskEvent (CLAUDE.md правило 3 — журнал только на запись).
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type {
  PassStatus,
  PaymentType,
  Role,
  TaskKind,
  TaskStatus,
  WorksheetStatus,
} from "@/generated/prisma/enums";
import { checkTransition, isDispatcherRole } from "./task-status";
import { assertTaskManager, isTaskManagerRole } from "./task-access";
import { resolveAssignedDate } from "./assign-date";
import { resolveCompletionDate, formatDayRu } from "./completion-date";
import { canViewTask } from "./authz";
import { resolveCoDriverOnAssign, validateCoDriver, CoDriverRuleError } from "./co-driver";
import { myTasksWhere, type MyTasksScope } from "./my-tasks";
import { overdueWhere, tomorrowPassWhere } from "./attention";
import { Errors } from "./errors";
import { resolveOccurredAt } from "./occurred-at";
import { notifyTaskAssignee, notifyCoDriverAssigned } from "@/lib/push";
import { geocodeAddress } from "@/lib/geocode";
import { computeEstimate } from "./capacity-service";
import { syncUnsignedDocMark } from "./kpi-service";
import { requireStaffTaskType } from "./task-type-service";
import { parseStaffNumberQuery } from "@/lib/task-number";
import { periodOf } from "./kpi";
import type { LatLng } from "./capacity";

export type Actor = { id: string; role: Role };

export type CreateTaskInput = {
  /** Контур задачи (15.08.2026). Не задан — доставка, как было до появления двух контуров. */
  kind?: TaskKind;
  typeId: string;
  title: string;
  address: string;
  description?: string | null;
  equipment?: string | null;
  orgName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  addressLink?: string | null;
  invoiceNumber?: string | null;
  paymentType?: PaymentType;
  paymentAmount?: number | null;
  paymentNote?: string | null;
  scheduledDate?: string | null; // YYYY-MM-DD
  timeFrom?: string | null;
  timeTo?: string | null;
  timeNote?: string | null;
  passStatus?: PassStatus;
  priority?: boolean;
  assigneeId?: string | null;
  coDriverId?: string | null; // напарник (20.07.2026, PRD §4): только при назначенном ответственном
  requiresAct?: boolean | null; // override требования акта (по умолчанию из типа); false = «акт не нужен»
  actWaivedNote?: string | null; // причина снятия требования акта на заявке
  carrierCost?: number | null; // стоимость поездки внешнего перевозчика, ₽ (этап 3, 02.07); водителям не отдаётся
  // Ёмкость (Фаза 2, PRD §14): ручная оценка времени диспетчером. number → manual (не пересчитывать);
  // null → сброс к авто-расчёту. undefined (поле не передано) → оценку не трогаем (пересчёт по правкам).
  estimatedMinutes?: number | null;
};

export type ListFilters = {
  date?: string; // одиночная дата (доска «Водители»)
  includeUndated?: boolean; // добавить пул «Без даты»
  dateFrom?: string;
  dateTo?: string;
  undatedOnly?: boolean;
  assigneeId?: string | "none"; // "none" — не назначено
  status?: TaskStatus;
  typeId?: string;
  q?: string;
  // Отменённые заявки вне рабочих экранов (11.08.2026): «Водители», «Планирование» и окно дня
  // календаря просят hideCancelled=1 — отменённая не мешает и не попадает ни в сумму часов, ни в
  // счётчик «N зад.». Во «Все задачи» флага нет: там отмену находят фильтром по статусу.
  hideCancelled?: boolean;
  // Архив (11.08.2026): по умолчанию списки показывают только активные заявки. scope="archive" —
  // раздел «Архив» во «Все задачи», scope="all" — служебная область (не используется в UI).
  scope?: "active" | "archive" | "all";
  /**
   * Контур (15.08.2026). Экраны доставок просят DELIVERY, вкладка «Цех» — STAFF.
   * Без фильтра отдаются оба — так «Все задачи» умеют показать любую заявку по номеру.
   */
  kind?: TaskKind;
};

// Краткие связи для карточек/списков (используется и записями: createTask/assign/transition...).
// createdBy — для бейджа «кто поставил заявку» (11.08.2026): постановщиков теперь двое (Милена и
// Максим), и на доске нужно видеть автора, не открывая карточку. Клиенту уходит плоским
// createdByName (см. withActFlag) — так же, как сделано в картотеке станков.
const taskInclude = {
  type: true,
  assignee: { select: { id: true, name: true, login: true } },
  coDriver: { select: { id: true, name: true, login: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.TaskInclude;

// Списки-чтения дополнительно тянут число приложенных актов (DOCUMENT-вложений) — лёгкий
// фильтрованный _count, чтобы показать признак комплектности акта (этап 14, PRD §13). filePath
// не раскрывается. Записи используют taskInclude без счётчика (им признак не нужен).
const taskListInclude = {
  ...taskInclude,
  _count: { select: { attachments: { where: { kind: "DOCUMENT" } } } },
} satisfies Prisma.TaskInclude;

// Полная карточка с историей.
const taskDetailInclude = {
  type: true,
  assignee: { select: { id: true, name: true, login: true } },
  coDriver: { select: { id: true, name: true, login: true } },
  createdBy: { select: { id: true, name: true } },
  events: {
    orderBy: { at: "asc" },
    include: { actor: { select: { id: true, name: true } } },
  },
  attachments: {
    orderBy: { createdAt: "asc" },
    // filePath/sizeBytes НЕ отдаём клиенту — файл берётся только через GET /api/attachments/:id.
    select: {
      id: true,
      kind: true,
      mimeType: true,
      createdById: true,
      lat: true,
      lng: true,
      createdAt: true,
    },
  },
  workItems: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      catalogItemId: true,
      name: true,
      quantity: true,
      price: true,
      sortOrder: true,
      createdById: true,
      createdAt: true,
    },
  },
} satisfies Prisma.TaskInclude;

export type TaskListItem = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
export type TaskDetail = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

// Карточка с цено-подсказками к позициям ведомости (этап «справочник»). defaultPrice добавляется
// ТОЛЬКО для диспетчера/админа (водителю цены не видны, PRD §13). Для водителя поле отсутствует.
// carrierCost опционален: водителю вырезается (stripMoneyForDriver), диспетчеру отдаётся.
type WorkItemWithHint = TaskDetail["workItems"][number] & { defaultPrice?: number | null };
export type TaskDetailWire = Omit<TaskDetail, "workItems" | "carrierCost"> & {
  workItems: WorkItemWithHint[];
  carrierCost?: number | null;
  // Имя убравшего заявку в архив (11.08.2026); null — заявка активна.
  archivedByName: string | null;
};

// Элемент списка для клиента: payload с _count, развёрнутым в булев флаг hasSignedDoc (этап 14).
// carrierCost опционален: у ответов ВОДИТЕЛЮ поле вырезано (stripMoneyForDriver), диспетчеру — есть.
type TaskListPayload = Prisma.TaskGetPayload<{ include: typeof taskListInclude }>;
export type TaskListWire = Omit<TaskListPayload, "_count" | "carrierCost"> & {
  hasSignedDoc: boolean;
  carrierCost?: number | null;
};

// Разворачивает фильтрованный _count в поле hasSignedDoc (и убирает служебный _count из ответа).
function withActFlag(t: TaskListPayload): TaskListWire {
  const { _count, ...rest } = t;
  return { ...rest, hasSignedDoc: _count.attachments > 0 };
}

/**
 * Денежные поля КОМПАНИИ, скрываемые от водителя (02.07, этап 3): стоимость поездки перевозчика.
 * Водителю уходит почти сырая строка Task, поэтому вырезаем явно на каждом водительском выходе
 * (listMyTasks, getTaskById, transitionTask, submitWorksheet). Новые «денежные» колонки — сюда же.
 */
export function stripMoneyForDriver<T extends { carrierCost?: number | null }>(
  t: T,
): Omit<T, "carrierCost"> {
  const { carrierCost: _hidden, ...rest } = t;
  void _hidden;
  return rest;
}

/**
 * Цены работ для того, кто ведёт заявки, но не расценивает (менеджер-сервисник, 11.08.2026).
 * Состав ведомости он видит — это часть заявки; суммы обнуляем, как водителю (PRD §13).
 * carrierCost при этом остаётся: стоимость поездки внешнего перевозчика вносит сам постановщик.
 */
function stripWorkPrices(task: TaskDetail & { archivedByName: string | null }): TaskDetailWire {
  return { ...task, workItems: task.workItems.map((w) => ({ ...w, price: null })) };
}

/**
 * Поля, которых у задачи сотрудникам не бывает (16.08.2026): адрес и всё вокруг него, деньги,
 * пропуск, перевозчик, требование акта и смена типа (тип служебный, один на весь контур).
 * При создании они уже обнулены — здесь тот же список для правки, чтобы контур нельзя было
 * «размыть» прямым PATCH мимо интерфейса.
 */
const DELIVERY_ONLY_FIELDS = [
  "typeId",
  "address",
  "addressLink",
  "orgName",
  "contactName",
  "contactPhone",
  "invoiceNumber",
  "equipment",
  "paymentType",
  "paymentAmount",
  "paymentNote",
  "passStatus",
  "carrierCost",
  "requiresAct",
  "actWaivedNote",
  "estimatedMinutes",
] as const satisfies readonly (keyof CreateTaskInput)[];

function stripDeliveryOnlyFields(fields: Partial<CreateTaskInput>): Partial<CreateTaskInput> {
  const out = { ...fields };
  for (const key of DELIVERY_ONLY_FIELDS) delete out[key];
  return out;
}

// Правила пары «ответственный + напарник» → единый формат ошибок API (Errors.validation).
function checkCoDriverRules(coDriverId: string | null, assigneeId: string | null): string | null {
  try {
    return validateCoDriver(coDriverId, assigneeId);
  } catch (e) {
    if (e instanceof CoDriverRuleError) throw Errors.validation(e.message);
    throw e;
  }
}

function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// Стоимость поездки перевозчика (этап 3): целое ≥ 0; null/undefined → null (не задана).
function validateCarrierCost(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0) throw Errors.validation("Стоимость поездки — целое число ≥ 0");
  return v;
}

// YYYY-MM-DD → Date в UTC-полночь (поле @db.Date хранит только дату; UTC исключает сдвиг на день).
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Чтения ----------------------------------------------------------------

export async function listTasks(filters: ListFilters): Promise<TaskListWire[]> {
  const and: Prisma.TaskWhereInput[] = [];

  // Архивные заявки не видны нигде, кроме явного раздела «Архив» (11.08.2026).
  if (filters.scope === "archive") and.push({ archivedAt: { not: null } });
  else if (filters.scope !== "all") and.push({ archivedAt: null });

  if (filters.undatedOnly) {
    and.push({ scheduledDate: null });
  } else if (filters.date) {
    const d = parseDate(filters.date);
    and.push(
      filters.includeUndated
        ? { OR: [{ scheduledDate: d }, { scheduledDate: null }] }
        : { scheduledDate: d },
    );
  } else if (filters.dateFrom || filters.dateTo) {
    const range: Prisma.DateTimeNullableFilter = {};
    const from = parseDate(filters.dateFrom);
    const to = parseDate(filters.dateTo);
    if (from) range.gte = from;
    if (to) range.lte = to;
    // includeUndated добавляет пул «Без даты» к диапазону (доска «Водители»: сегодня…+2 + без даты).
    and.push(
      filters.includeUndated
        ? { OR: [{ scheduledDate: range }, { scheduledDate: null }] }
        : { scheduledDate: range },
    );
  }

  if (filters.assigneeId === "none") and.push({ assigneeId: null });
  // Фильтр «исполнитель» показывает всё, что занимает день водителя, включая парные задачи,
  // где он напарник (20.07.2026) — консистентно с ячейками календаря загрузки.
  else if (filters.assigneeId)
    and.push({ OR: [{ assigneeId: filters.assigneeId }, { coDriverId: filters.assigneeId }] });

  if (filters.status) and.push({ status: filters.status });
  else if (filters.hideCancelled) and.push({ status: { not: "CANCELLED" } });
  if (filters.typeId) and.push({ typeId: filters.typeId });
  if (filters.kind) and.push({ kind: filters.kind });

  const q = filters.q?.trim();
  if (q) {
    const or: Prisma.TaskWhereInput[] = [
      { title: { contains: q, mode: "insensitive" } },
      { orgName: { contains: q, mode: "insensitive" } },
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { equipment: { contains: q, mode: "insensitive" } },
      { contactPhone: { contains: q, mode: "insensitive" } },
    ];
    // № заявки: только короткие цифровые строки — длинные (телефон) переполнили бы Int-колонку
    // (Prisma кидает ошибку валидации на where number = 8926… → 500 на весь список).
    if (/^\d{1,9}$/.test(q)) or.push({ number: Number.parseInt(q, 10) });

    // Номер цеха: «Ц-5», «ц5», «c5» и просто «5» (16.08.2026). Доставкам это не мешает — у них
    // staffNumber пуст, и лишних совпадений такое условие не даёт даже без фильтра по контуру.
    const staffNo = parseStaffNumberQuery(q);
    if (staffNo !== null) or.push({ staffNumber: staffNo });

    // Цифры запроса: «№615» находит № заявки, «8 926 123-45-67» — телефон в любом формате записи.
    const digits = q.replace(/\D/g, "");
    if (digits && digits !== q && /^\d{1,9}$/.test(digits) && digits.length <= 6) {
      or.push({ number: Number.parseInt(digits, 10) });
    }
    if (digits.length >= 3) {
      const ids = await findTaskIdsByPhoneDigits(digits);
      if (ids.length > 0) or.push({ id: { in: ids } });
    }
    and.push({ OR: or });
  }

  const rows = await prisma.task.findMany({
    where: and.length ? { AND: and } : {},
    include: taskListInclude,
    orderBy: [{ priority: "desc" }, { scheduledDate: "asc" }, { number: "asc" }],
  });
  return rows.map(withActFlag);
}

/**
 * Поиск задач по цифрам телефона: сравниваем цифры запроса с цифрами contactPhone, «8…» и «+7…»
 * считаем одним номером. Милена вводит телефоны в свободном формате («+7 (926) 123-45-67»,
 * «8926…»), поэтому обычный contains по строке номер не находит. Запрос параметризован
 * (Prisma.sql), full-scan приемлем: задач единицы тысяч, вызов — только при ≥3 цифрах в поиске.
 */
async function findTaskIdsByPhoneDigits(digits: string): Promise<string[]> {
  const variants = [digits];
  if (digits.startsWith("8")) variants.push(`7${digits.slice(1)}`);
  else if (digits.startsWith("7")) variants.push(`8${digits.slice(1)}`);
  const conditions = variants.map(
    (v) => Prisma.sql`regexp_replace(coalesce("contactPhone", ''), '\\D', '', 'g') LIKE ${`%${v}%`}`,
  );
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Task" WHERE ${Prisma.join(conditions, " OR ")}`,
  );
  return rows.map((r) => r.id);
}

/**
 * Список задач водителя для PWA (ARCHITECTURE §6, §7). ЖЁСТКАЯ изоляция: where прибит к
 * actor.id через myTasksWhere — другого пути выборки нет. Личность приходит из сессии
 * (route handler), `today` — локальная дата клиента «YYYY-MM-DD».
 */
export async function listMyTasks(
  actor: Actor,
  opts: { today: string; scope?: MyTasksScope },
): Promise<TaskListWire[]> {
  const today = parseDate(opts.today);
  if (!today) throw Errors.validation("Некорректная дата");
  const rows = await prisma.task.findMany({
    where: myTasksWhere(actor.id, today, opts.scope ?? "today"),
    include: taskListInclude,
    orderBy: [
      { priority: "desc" },
      { scheduledDate: "asc" },
      { timeFrom: "asc" },
      { number: "asc" },
    ],
  });
  // Деньги компании (carrierCost) водителю не отдаём (02.07, этап 3).
  return rows.map(withActFlag).map(stripMoneyForDriver);
}

export type BoardAttention = {
  overdue: TaskListWire[]; // незавершённые с прошедшей датой
  tomorrowPasses: TaskListWire[]; // на завтра пропуск «нужен, не заказан» (PRD §6)
};

/**
 * Блок «Требуют внимания» для доски диспетчера (Этап 6). Только для диспетчера/админа —
 * вызывается из эндпоинта за requireDispatcher (он видит все задачи, PRD §2).
 * `today` — локальная дата клиента «YYYY-MM-DD»; завтра считаем как today+1 (UTC, как @db.Date).
 */
export async function listAttention(today: string): Promise<BoardAttention> {
  const todayDate = parseDate(today);
  if (!todayDate) throw Errors.validation("Некорректная дата");
  const tomorrow = new Date(todayDate);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [overdue, tomorrowPasses] = await Promise.all([
    prisma.task.findMany({
      where: overdueWhere(todayDate),
      include: taskListInclude,
      orderBy: [{ scheduledDate: "asc" }, { priority: "desc" }, { number: "asc" }],
    }),
    prisma.task.findMany({
      where: tomorrowPassWhere(tomorrow),
      include: taskListInclude,
      orderBy: [{ priority: "desc" }, { number: "asc" }],
    }),
  ]);
  return { overdue: overdue.map(withActFlag), tomorrowPasses: tomorrowPasses.map(withActFlag) };
}

/** Карточка задачи с историей. Изоляция: водителю чужая задача отдаёт 404. */
export async function getTaskById(taskId: string, actor: Actor): Promise<TaskDetailWire> {
  const row = await prisma.task.findUnique({ where: { id: taskId }, include: taskDetailInclude });
  if (!row) throw Errors.notFound();
  if (!canViewTask(actor, row)) throw Errors.notFound();
  // Имя убравшего в архив (11.08.2026): archivedById — uuid без навигации (как принято в проекте),
  // поэтому имя достаём отдельным точечным запросом и только когда заявка действительно в архиве.
  const archivedByName = row.archivedById
    ? ((await prisma.user.findUnique({ where: { id: row.archivedById }, select: { name: true } }))?.name ?? null)
    : null;
  const task = { ...row, archivedByName };
  // Диспетчеру/админу подставляем цену-подсказку из справочника к позициям ведомости (для расценки).
  // Всем остальным — НЕ отдаём (PRD §13: водителю цены не видны; менеджеру-сервиснику расценка тоже
  // закрыта — 11.08.2026, у него заявки без денежного контура). carrierCost — стоимость поездки
  // внешнего перевозчика — это поле самой заявки, его вырезаем только водителю (stripMoneyForDriver).
  if (!isDispatcherRole(actor.role)) {
    return isTaskManagerRole(actor.role) ? stripWorkPrices(task) : stripMoneyForDriver(task);
  }
  const ids = [
    ...new Set(task.workItems.map((w) => w.catalogItemId).filter((x): x is string => x !== null)),
  ];
  if (ids.length === 0) return task;
  const hints = await prisma.workCatalogItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, defaultPrice: true },
  });
  const priceById = new Map(hints.map((h) => [h.id, h.defaultPrice]));
  return {
    ...task,
    workItems: task.workItems.map((w) => ({
      ...w,
      defaultPrice: w.catalogItemId ? (priceById.get(w.catalogItemId) ?? null) : null,
    })),
  };
}

// --- Записи ----------------------------------------------------------------

export async function createTask(
  input: Partial<CreateTaskInput>,
  actor: Actor,
): Promise<TaskListItem> {
  assertTaskManager(actor);

  // Контур решает почти всё дальнейшее: у задачи сотрудникам нет ни адреса, ни денег, ни актов —
  // только «что сделать», кому и когда (решение Артёма 15.08.2026).
  const kind: TaskKind = input.kind === "STAFF" ? "STAFF" : "DELIVERY";
  const staff = kind === "STAFF";

  // Классификации у задач сотрудникам нет, но Task.typeId обязателен — служебный тип подставляет
  // сервер: форма его не знает и не показывает.
  const typeId = staff ? (await requireStaffTaskType()).id : input.typeId;
  const title = clean(input.title);
  // Адрес у задачи сотрудникам не спрашивают: работа в цехе или разъезды по снабжению не ложатся в
  // одну строку адреса. Колонку не делаем nullable (её читает весь код доставок) — храним пустую.
  const address = staff ? "" : clean(input.address);
  const orgName = staff ? null : clean(input.orgName);
  const contactName = staff ? null : clean(input.contactName);
  const contactPhone = staff ? null : clean(input.contactPhone);
  if (!typeId) throw Errors.validation("Не выбран тип задачи");
  if (!title) throw Errors.validation("Не указано название");
  if (!staff && !address) throw Errors.validation("Не указан адрес");
  // Дальше адрес — всегда строка: у доставки он проверен выше, у задачи сотрудникам пустой.
  const addressValue = address ?? "";
  // Организация, контакт, телефон — НЕобязательны при создании (решение Артёма 24.07.2026: быстрая
  // постановка заявки; раньше были обязательны — 02.07). Обязательны только Тип, Название, Адрес.
  // Редактирование (updateTaskFields) тоже мягкое — поля можно очищать в null.

  // Тип задаёт дефолт требования акта; диспетчер может снять его галочкой «акт не нужен» (PRD §4).
  const type = await prisma.taskType.findUnique({
    where: { id: typeId },
    select: { requiresSignedDoc: true, requiresPricing: true, onSiteMinutes: true, kind: true },
  });
  if (!type) throw Errors.validation("Неизвестный тип задачи");
  // Тип и контур обязаны сойтись: заявка водителю со служебным типом (и наоборот) означала бы, что
  // задача попала не на тот экран и мимо всех расчётов.
  if (type.kind !== kind) throw Errors.validation("Тип задачи не из этого раздела");
  const requiresSignedDoc =
    input.requiresAct === undefined || input.requiresAct === null ? type.requiresSignedDoc : input.requiresAct;
  // Причину снятия храним, только когда акт реально сняли с типа, который его ожидал.
  const actWaivedNote = !requiresSignedDoc && type.requiresSignedDoc ? clean(input.actWaivedNote) : null;
  // Ведомость работ заводится сразу в DRAFT для типов с расценкой (этап 12, PRD §13).
  const worksheetStatus: WorksheetStatus | null = type.requiresPricing ? "DRAFT" : null;

  let assigneeId: string | null = null;
  if (input.assigneeId) {
    assigneeId = await assertAssignableFor(kind, input.assigneeId);
  }
  const status: TaskStatus = assigneeId ? "ASSIGNED" : "NEW";

  // Напарник (20.07.2026, PRD §4): только при ответственном и != ему. С 16.08.2026 пара работает и
  // в цехе (решение Артёма): двое собирают станок так же, как двое едут на выезд. Кого можно взять
  // напарником, решает контур — водителя в доставку, исполнителя с доступом к цеху в цех.
  let coDriverId: string | null = null;
  let coDriverName = "";
  if (input.coDriverId) {
    coDriverId = await assertAssignableFor(kind, input.coDriverId);
    coDriverId = checkCoDriverRules(coDriverId, assigneeId);
    if (coDriverId) {
      const u = await prisma.user.findUnique({ where: { id: coDriverId }, select: { name: true } });
      coDriverName = u?.name ?? "";
    }
  }

  // Стоимость поездки перевозчика (этап 3, 02.07): целое ≥ 0, вводит диспетчер.
  const carrierCost = staff ? null : validateCarrierCost(input.carrierCost);

  // Оценка времени (Фаза 2, PRD §14): геокодируем адрес и считаем «норма типа + дорога».
  // Геокод и расчёт — ДО транзакции (внешний вызов не держит БД). Сбой геокодера → дорога не учтена.
  // Задачи сотрудникам в ёмкость не входят: адреса у них нет, а «норма на объекте» бессмысленна —
  // поэтому ни геокода, ни оценки (в календаре загрузки они и не показываются).
  const timeFromClean = clean(input.timeFrom);
  const point = staff ? null : await geocodeAddress(addressValue);
  const estimate = staff
    ? { totalMinutes: null }
    : await computeEstimate({
        onSiteMinutes: type.onSiteMinutes,
        point,
        timeFrom: timeFromClean,
      });

  const created = await prisma.$transaction(async (tx) => {
    // Номер цеха «Ц-N» (16.08.2026) — из своей последовательности, внутри той же транзакции, что и
    // сама задача: не создалась — номер не «сгорел» зря. У доставки номер цеха пуст.
    const staffNumber = staff ? await nextStaffNumber(tx) : null;
    const task = await tx.task.create({
      data: {
        typeId,
        kind,
        staffNumber,
        title,
        address: addressValue,
        description: clean(input.description),
        equipment: clean(input.equipment),
        orgName,
        contactName,
        contactPhone,
        addressLink: clean(input.addressLink),
        invoiceNumber: clean(input.invoiceNumber),
        // Денег у задач сотрудникам не бывает — ни оплаты на точке, ни суммы, ни заметки.
        paymentType: staff ? "NONE" : (input.paymentType ?? "NONE"),
        paymentAmount: staff ? null : (input.paymentAmount ?? null),
        paymentNote: staff ? null : clean(input.paymentNote),
        carrierCost,
        scheduledDate: parseDate(input.scheduledDate),
        timeFrom: timeFromClean,
        timeTo: clean(input.timeTo),
        timeNote: clean(input.timeNote),
        passStatus: staff ? "NOT_NEEDED" : (input.passStatus ?? "NOT_NEEDED"),
        priority: input.priority ?? false,
        requiresSignedDoc,
        actWaivedNote,
        worksheetStatus,
        status,
        assigneeId,
        coDriverId,
        // Ёмкость (Фаза 2): координаты геокода + авто-оценка времени (estimateIsManual=false).
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        estimatedMinutes: estimate.totalMinutes,
        createdById: actor.id,
      },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        actorId: actor.id,
        kind: "created",
        toStatus: status,
        comment: assigneeId ? "Создана и назначена" : "Создана",
      },
    });
    // Пара — отдельным событием журнала (kind:"assist"), как назначение (CLAUDE.md правило 3).
    if (coDriverId) {
      await tx.taskEvent.create({
        data: { taskId: task.id, actorId: actor.id, kind: "assist", comment: `Напарник: ${coDriverName}` },
      });
    }
    return task;
  });
  // Пуш назначенному водителю (PRD §7). notifyTaskAssignee — no-op, если задача не назначена.
  notifyTaskAssignee(created, "assigned", actor.id);
  // Напарнику — отдельный пуш «Ты напарник по заявке №N» (PRD §7, 20.07.2026).
  notifyCoDriverAssigned(created, actor.id);
  return created;
}

export async function updateTaskFields(
  taskId: string,
  fields: Partial<CreateTaskInput>,
  actor: Actor,
): Promise<TaskListItem> {
  assertTaskManager(actor);
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  assertNotArchived(task.archivedAt);
  // Правка задачи цеха идёт по правилам её контура (16.08.2026): полей доставки у неё нет и при
  // создании они жёстко обнулены — значит и здесь их принимать нельзя, иначе через прямой PATCH у
  // задачи цеха завелись бы адрес, оплата или чужой тип. Молча отбрасываем: это не ошибка
  // диспетчера, а поля, которых у контура не существует.
  if (task.kind === "STAFF") fields = stripDeliveryOnlyFields(fields);
  // Редактирование закрытых заявок (решение Артёма 02.07.2026): правка полей разрешена и для
  // завершённых/отменённых, НО без смены даты (перенос завершённой запрещён — как в planTask).
  const terminal = task.status === "DONE" || task.status === "CANCELLED";
  const actRequirementTouched = fields.requiresAct !== undefined;

  const data: Prisma.TaskUpdateInput = {};
  const set = <K extends keyof CreateTaskInput>(key: K, apply: (v: NonNullable<CreateTaskInput[K]> | null) => void) => {
    if (fields[key] !== undefined) apply((fields[key] ?? null) as NonNullable<CreateTaskInput[K]> | null);
  };

  if (fields.title !== undefined) {
    const t = clean(fields.title);
    if (!t) throw Errors.validation("Название не может быть пустым");
    data.title = t;
  }
  let addressChanged = false;
  let effectiveAddress = task.address;
  if (fields.address !== undefined) {
    const a = clean(fields.address);
    if (!a) throw Errors.validation("Адрес не может быть пустым");
    data.address = a;
    addressChanged = a !== task.address;
    effectiveAddress = a;
  }
  if (fields.typeId !== undefined && fields.typeId) data.type = { connect: { id: fields.typeId } };
  set("description", (v) => (data.description = v));
  set("equipment", (v) => (data.equipment = v));
  set("orgName", (v) => (data.orgName = v));
  set("contactName", (v) => (data.contactName = v));
  set("contactPhone", (v) => (data.contactPhone = v));
  set("addressLink", (v) => (data.addressLink = v));
  set("invoiceNumber", (v) => (data.invoiceNumber = v));
  if (fields.paymentType !== undefined) data.paymentType = fields.paymentType;
  if (fields.paymentAmount !== undefined) data.paymentAmount = fields.paymentAmount ?? null;
  set("paymentNote", (v) => (data.paymentNote = v));
  // Стоимость поездки перевозчика (этап 3, 02.07): валидация как при создании.
  if (fields.carrierCost !== undefined) data.carrierCost = validateCarrierCost(fields.carrierCost);
  // Дату завершённой/отменённой заявки не двигаем (подстраховка от прямого API-вызова; в форме поле скрыто).
  if (fields.scheduledDate !== undefined && !terminal) data.scheduledDate = parseDate(fields.scheduledDate);
  set("timeFrom", (v) => (data.timeFrom = v));
  set("timeTo", (v) => (data.timeTo = v));
  set("timeNote", (v) => (data.timeNote = v));
  if (fields.passStatus !== undefined) data.passStatus = fields.passStatus;
  if (fields.priority !== undefined) data.priority = fields.priority;
  if (fields.requiresAct !== undefined) {
    const req = fields.requiresAct ?? false;
    data.requiresSignedDoc = req;
    data.actWaivedNote = req ? null : clean(fields.actWaivedNote);
  }

  // Напарник (20.07.2026, PRD §4): правка пары из формы/карточки. Ответственного эта ручка не
  // меняет — валидируем против текущего task.assigneeId. Для закрытых задач пару не трогаем
  // (подстраховка от прямого API-вызова, как со scheduledDate; в UI селект скрыт).
  let coDriverChanged = false;
  let newCoDriverId: string | null = task.coDriverId;
  let newCoDriverName = "";
  if (fields.coDriverId !== undefined && !terminal) {
    // Кого можно взять напарником, решает контур задачи (16.08.2026): в доставку — водителя,
    // в цех — того, кому открыт доступ к задачам сотрудникам.
    const wanted = fields.coDriverId ? await assertAssignableFor(task.kind, fields.coDriverId) : null;
    newCoDriverId = checkCoDriverRules(wanted, task.assigneeId);
    // Жёсткий запрет (20.07): в АКТИВНУЮ доставку нельзя добавить напарника, занятого другой
    // активной доставкой (своей или парной) — иначе он был бы «в работе» в двух местах сразу.
    // Цеха это правило не касается (15.08): контуры параллельны, работа в цехе не занимает маршрут.
    if (
      newCoDriverId &&
      newCoDriverId !== task.coDriverId &&
      task.status === "IN_PROGRESS" &&
      task.kind === "DELIVERY"
    ) {
      const busy = await prisma.task.findFirst({
        where: {
          OR: [{ assigneeId: newCoDriverId }, { coDriverId: newCoDriverId }],
          status: "IN_PROGRESS",
          kind: "DELIVERY", // задача в цехе не делает напарника занятым на маршруте
          id: { not: taskId },
        },
        select: { number: true },
      });
      if (busy) throw Errors.activeTaskExists(busy.number);
    }
    if ((task.coDriverId ?? null) !== newCoDriverId) {
      coDriverChanged = true;
      data.coDriver = newCoDriverId ? { connect: { id: newCoDriverId } } : { disconnect: true };
      if (newCoDriverId) {
        const u = await prisma.user.findUnique({
          where: { id: newCoDriverId },
          select: { name: true },
        });
        newCoDriverName = u?.name ?? "";
      }
    }
  }

  // --- Оценка времени (Фаза 2, PRD §14) ---
  // Ручная оценка диспетчера: number → фиксируем (manual, не пересчитываем); null → сброс к авто.
  const resetToAuto = fields.estimatedMinutes === null;
  let willBeManual = task.estimateIsManual;
  if (fields.estimatedMinutes !== undefined && fields.estimatedMinutes !== null) {
    const minutes = Math.round(fields.estimatedMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) throw Errors.validation("Некорректная оценка времени");
    data.estimatedMinutes = minutes;
    data.estimateIsManual = true;
    willBeManual = true;
  } else if (resetToAuto) {
    willBeManual = false;
  }

  // Авто-пересчёт нужен, когда оценка не ручная и поменялось что-то влияющее (адрес/тип/время выезда),
  // либо диспетчер явно сбросил к авто. Дата на величину оценки не влияет (пробки — по времени суток).
  const typeChanged = fields.typeId !== undefined && !!fields.typeId && fields.typeId !== task.typeId;
  const timeFromChanged = fields.timeFrom !== undefined && clean(fields.timeFrom) !== task.timeFrom;
  if (!willBeManual && (addressChanged || typeChanged || timeFromChanged || resetToAuto)) {
    const effectiveTypeId = fields.typeId ?? task.typeId;
    const t = await prisma.taskType.findUnique({
      where: { id: effectiveTypeId },
      select: { onSiteMinutes: true },
    });
    const onSiteMinutes = t?.onSiteMinutes ?? 30;
    const effectiveTimeFrom = fields.timeFrom !== undefined ? clean(fields.timeFrom) : task.timeFrom;
    // При смене адреса геокодируем заново (и обновляем lat/lng); иначе берём сохранённые координаты.
    let point: LatLng | null;
    if (addressChanged) {
      point = await geocodeAddress(effectiveAddress);
      data.lat = point?.lat ?? null;
      data.lng = point?.lng ?? null;
    } else {
      point = task.lat != null && task.lng != null ? { lat: task.lat, lng: task.lng } : null;
    }
    const estimate = await computeEstimate({ onSiteMinutes, point, timeFrom: effectiveTimeFrom });
    data.estimatedMinutes = estimate.totalMinutes;
    data.estimateIsManual = false;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data, include: taskInclude });
    await tx.taskEvent.create({
      data: { taskId, actorId: actor.id, kind: "edit", comment: "Изменены поля задачи" },
    });
    if (coDriverChanged) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "assist",
          comment: newCoDriverId ? `Напарник: ${newCoDriverName}` : "Напарник снят",
        },
      });
    }
    return updated;
  });
  // Смена требования акта могла повлиять на KPI-нарушение «без акта»: пересчитываем открытый месяц
  // (снятие → гасим подтверждённый штраф, возврат → возвращаем кандидата). Закрытый снимок не трогаем.
  if (actRequirementTouched) await syncUnsignedDocMark(taskId, actor);
  // «Изменена» шлём, только если менялись обычные поля: правка одного напарника не должна давать
  // ответственному лишний пуш (напарнику уходит свой, ниже).
  const otherFieldsTouched = Object.keys(data).length > (coDriverChanged ? 1 : 0);
  if (otherFieldsTouched) notifyTaskAssignee(result, "changed", actor.id);
  if (coDriverChanged && newCoDriverId) notifyCoDriverAssigned(result, actor.id);
  return result;
}

/** preflight-аудит В3: у исполнителя не может быть двух задач «В работе» одновременно. Проверяется
 *  при переназначении АКТИВНОЙ (IN_PROGRESS) задачи на другого водителя — assign/plan меняют только
 *  assigneeId, не трогая статус, поэтому инвариант ACTIVE_TASK_EXISTS (он же в transitionTask)
 *  дублируется здесь. Снятие назначения и неактивные задачи не затрагиваются. */
async function assertNoOtherActiveTask(
  taskId: string,
  newAssigneeId: string | null,
  currentAssigneeId: string | null,
  status: TaskStatus,
  kind: TaskKind = "DELIVERY",
): Promise<void> {
  if (!newAssigneeId || newAssigneeId === currentAssigneeId || status !== "IN_PROGRESS") return;
  // Правило «одна активная» — про доставки: работа в цехе идёт параллельно и не занимает водителя
  // на маршруте (решение Артёма 15.08.2026).
  if (kind === "STAFF") return;
  const other = await prisma.task.findFirst({
    where: {
      OR: [{ assigneeId: newAssigneeId }, { coDriverId: newAssigneeId }],
      status: "IN_PROGRESS",
      kind: "DELIVERY",
      id: { not: taskId },
    },
    select: { number: true, coDriverId: true },
  });
  if (other) {
    throw other.coDriverId === newAssigneeId
      ? Errors.activePairTaskExists(other.number)
      : Errors.activeTaskExists(other.number);
  }
}

export async function assignTask(
  taskId: string,
  assigneeId: string | null,
  actor: Actor,
  opts: { today?: string } = {},
): Promise<TaskListItem> {
  assertTaskManager(actor);
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  assertNotArchived(task.archivedAt);
  if (task.status === "DONE" || task.status === "CANCELLED") throw Errors.invalidTransition();

  let name = "";
  if (assigneeId) {
    await assertAssignableFor(task.kind, assigneeId);
    const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } });
    name = u?.name ?? "";
  }

  // Перенос активной задачи другому водителю не должен дать ему вторую «В работе» (В3).
  await assertNoOtherActiveTask(taskId, assigneeId, task.assigneeId, task.status, task.kind);

  // Судьба напарника при смене ответственного (20.07.2026): на напарника → swap ролей,
  // на третьего/снятие → пара распадается, тот же → без изменений (см. co-driver.ts).
  const pair = resolveCoDriverOnAssign(
    { assigneeId: task.assigneeId, coDriverId: task.coDriverId },
    assigneeId,
  );

  // Назначение задаёт ASSIGNED для новой; снятие назначения возвращает в NEW.
  let status = task.status;
  if (assigneeId && task.status === "NEW") status = "ASSIGNED";
  if (!assigneeId && task.status === "ASSIGNED") status = "NEW";

  // п.1: назначение задачи БЕЗ даты на водителя автоматически ставит сегодняшнюю дату.
  // `today` — локальная дата клиента «YYYY-MM-DD»; если не передана, берём дату сервера (UTC) как запас.
  const today = parseDate(opts.today) ?? parseDate(new Date().toISOString().slice(0, 10));
  const autoDate = resolveAssignedDate(task.scheduledDate, assigneeId, today);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        assigneeId,
        coDriverId: pair.coDriverId,
        status,
        ...(autoDate ? { scheduledDate: autoDate } : {}),
      },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: "assign",
        fromStatus: task.status,
        toStatus: status,
        comment: assigneeId ? `Назначен: ${name}` : "Снято назначение",
      },
    });
    if (pair.event) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "assist",
          comment:
            pair.event === "swap"
              ? "Ответственный и напарник поменялись ролями"
              : "Напарник снят (смена ответственного)",
        },
      });
    }
    // Отдельная неизменяемая отметка в журнал об авто-простановке даты (CLAUDE.md правило 3).
    // Просроченная задача (была дата в прошлом) при назначении переносится на сегодня — в истории это
    // видно явно (доработка 24.07.2026, перетаскивание из «Требуют внимания»); задача без даты —
    // просто датируется сегодняшним днём.
    if (autoDate) {
      const wasOverdue = task.scheduledDate !== null && task.scheduledDate.getTime() < autoDate.getTime();
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "auto_date",
          comment: wasOverdue
            ? `Была просрочена (${formatDayRu(task.scheduledDate)}) → перенесена на сегодня (${formatDayRu(autoDate)}) при назначении`
            : `Дата проставлена автоматически при назначении: ${formatDayRu(autoDate)}`,
        },
      });
    }
    return updated;
  });
  // Назначение → пуш новому исполнителю; снятие назначения (assigneeId=null) — no-op.
  notifyTaskAssignee(result, "assigned", actor.id);
  // Swap: экс-ответственный стал напарником — сообщаем ему новую роль.
  if (pair.event === "swap") notifyCoDriverAssigned(result, actor.id);
  return result;
}

/**
 * Планирование задачи на сетке «Планирование» (п.3): атомарно задаёт дату И исполнителя
 * (перетаскивание в ячейку «день × водитель»). Дата — edit-поле, назначение — ось NEW↔ASSIGNED
 * (как assignTask), матрица статусов не обходится. Пишет осмысленные события за реальные изменения.
 */
export async function planTask(
  taskId: string,
  input: { scheduledDate: string | null; assigneeId: string | null },
  actor: Actor,
): Promise<TaskListItem> {
  assertTaskManager(actor);
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  assertNotArchived(task.archivedAt);
  if (task.status === "DONE" || task.status === "CANCELLED") throw Errors.invalidTransition();

  const newDate = parseDate(input.scheduledDate);
  const assigneeId = input.assigneeId ?? null;

  let name = "";
  if (assigneeId) {
    await assertAssignableFor(task.kind, assigneeId);
    const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } });
    name = u?.name ?? "";
  }

  // Перенос активной задачи другому водителю не должен дать ему вторую «В работе» (В3).
  await assertNoOtherActiveTask(taskId, assigneeId, task.assigneeId, task.status, task.kind);

  // Судьба напарника при смене ответственного — как в assignTask (swap/removed/none).
  const pair = resolveCoDriverOnAssign(
    { assigneeId: task.assigneeId, coDriverId: task.coDriverId },
    assigneeId,
  );

  // Статус по оси назначения (как в assignTask): NEW↔ASSIGNED, прочие статусы не трогаем.
  let status = task.status;
  if (assigneeId && task.status === "NEW") status = "ASSIGNED";
  if (!assigneeId && task.status === "ASSIGNED") status = "NEW";

  const dateKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const dateChanged = dateKey(task.scheduledDate) !== dateKey(newDate);
  const assigneeChanged = (task.assigneeId ?? null) !== assigneeId;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { scheduledDate: newDate, assigneeId, coDriverId: pair.coDriverId, status },
      include: taskInclude,
    });
    if (dateChanged) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "reschedule",
          fromStatus: task.status,
          toStatus: status,
          comment: newDate
            ? `Запланирована на ${dateKey(newDate)}`
            : "Дата снята (пул «Без даты»)",
        },
      });
    }
    if (assigneeChanged) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "assign",
          fromStatus: task.status,
          toStatus: status,
          comment: assigneeId ? `Назначен: ${name}` : "Снято назначение",
        },
      });
    }
    if (pair.event) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "assist",
          comment:
            pair.event === "swap"
              ? "Ответственный и напарник поменялись ролями"
              : "Напарник снят (смена ответственного)",
        },
      });
    }
    return updated;
  });
  // Пуш новому исполнителю при назначении/смене (no-op, если назначения нет).
  if (assigneeChanged) notifyTaskAssignee(result, "assigned", actor.id);
  else if (dateChanged) notifyTaskAssignee(result, "rescheduled", actor.id);
  // Swap: экс-ответственный стал напарником — сообщаем ему новую роль.
  if (pair.event === "swap") notifyCoDriverAssigned(result, actor.id);
  return result;
}

/**
 * Архив заявки (решение Артёма 11.08.2026): убрать дубль или ошибочно заведённую заявку из работы,
 * не ломая нумерацию и не переписывая журнал. Это НЕ статус (матрица §5 не менялась) и не удаление:
 * строка остаётся, события остаются, номер за заявкой сохраняется. Архивная заявка исчезает из всех
 * рабочих выборок и из аналитики (сводка, KPI, календарь загрузки, списки водителя).
 *
 * Гейт закрытого месяца: завершённая заявка уже посчитана в зарплате, поэтому убрать её из
 * закрытого периода нельзя — иначе задним числом поедут выплаченные цифры. Открытый месяц можно:
 * там пересчёт и так живой.
 */
export async function archiveTask(
  taskId: string,
  actor: Actor,
  reason?: string | null,
): Promise<TaskListItem> {
  assertTaskManager(actor);
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (task.archivedAt) throw Errors.validation("Заявка уже в архиве");
  await assertArchivePeriodOpen(task.completedAt);

  const note = clean(reason);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date(), archivedById: actor.id },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: "archive",
        comment: note ? `В архив: ${note}` : "В архив",
      },
    });
    // Нерешённых кандидатов в нарушения по этой заявке убираем: держать в списке Милены нарушение
    // по заявке, которой больше нет в работе, — мусор. Решённые (CONFIRMED/DISMISSED) не трогаем —
    // это её решение и, возможно, уже посчитанные деньги. При возврате из архива ночной детектор
    // заведёт кандидатов заново (он идемпотентный).
    await tx.kpiMark.deleteMany({ where: { taskId, status: "CANDIDATE" } });
    return updated;
  });
}

/** Вернуть заявку из архива (та же кнопка наоборот) — если убрали по ошибке. */
export async function unarchiveTask(taskId: string, actor: Actor): Promise<TaskListItem> {
  assertTaskManager(actor);
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (!task.archivedAt) throw Errors.validation("Заявка не в архиве");
  await assertArchivePeriodOpen(task.completedAt);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { archivedAt: null, archivedById: null },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: { taskId, actorId: actor.id, kind: "unarchive", comment: "Возвращена из архива" },
    });
    return updated;
  });
}

/** Заявка в архиве выведена из работы: править и вести её статусы нельзя, пока не вернули. */
function assertNotArchived(archivedAt: Date | null): void {
  if (archivedAt) throw Errors.validation("Заявка в архиве — сначала верните её из архива");
}

// Завершённая заявка из ЗАКРЫТОГО расчётного месяца не уходит в архив и не возвращается из него:
// её вклад в KPI и зарплату уже заморожен снимком PayrollStatement. Незавершённых это не касается.
async function assertArchivePeriodOpen(completedAt: Date | null): Promise<void> {
  if (!completedAt) return;
  const period = periodOf(completedAt);
  const closed = await prisma.payrollStatement.count({ where: { period } });
  if (closed > 0) throw Errors.periodClosed();
}

export type TransitionOptions = {
  comment?: string | null;
  reason?: string | null;
  lat?: number | null;
  lng?: number | null;
  paymentConfirmed?: boolean; // DONE при оплате «на месте»: подтверждение получения денег (PRD §5)
  paymentAmount?: number | null; // фактически полученная сумма (по умолчанию — ожидаемая из задачи)
  paymentMissedReason?: string | null; // DONE при ON_SITE без оплаты: причина неоплаты (№8)
  actMissedReason?: string | null; // DONE актовой задачи без акта: причина водителя (акты до 20:00, 02.07)
  // Офлайн-режим: ISO-время момента действия на телефоне. Пишется в TaskEvent.at (и completedAt при
  // DONE) вместо времени досылки, с проверкой достоверности (src/domain/occurred-at.ts).
  occurredAt?: string | null;
};

// Ответ transition: carrierCost опционален — водителю вырезан (stripMoneyForDriver), диспетчеру есть.
export type TaskItemWire = Omit<TaskListItem, "carrierCost"> & { carrierCost?: number | null };

export async function transitionTask(
  taskId: string,
  toStatus: TaskStatus,
  actor: Actor,
  opts: TransitionOptions = {},
): Promise<TaskItemWire> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound(); // изоляция: чужая → 404
  // Архивная заявка выведена из работы (11.08.2026): вести её статусы нельзя — ни водителю по старой
  // ссылке (из списков она пропала, но ссылка и офлайн-очередь могли остаться), ни диспетчеру.
  // Нужно продолжить работу — сначала «Вернуть из архива».
  assertNotArchived(task.archivedAt);

  const isAssignee = task.assigneeId !== null && task.assigneeId === actor.id;
  const verdict = checkTransition({ role: actor.role, isAssignee }, task.status, toStatus);
  if (!verdict.ok) throw Errors.invalidTransition();

  const reason = clean(opts.reason) ?? clean(opts.comment);
  if (verdict.reasonRequired && !reason) throw Errors.reasonRequired();

  // Завершение (DONE) при оплате «на месте» (№8, решение Артёма 23.06): жёсткого запрета завершить
  // без денег больше нет. Но водитель обязан отметить ОДНО из двух — деньги получены ЛИБО не получены
  // с причиной (чтобы инфа не терялась). Без выбора — просим определиться (это не возврат старого гейта).
  // Фото — по желанию (не блокирует); требуемый акт — мягкая отметка KPI, не запрет.
  const unpaidReason =
    toStatus === "DONE" && task.paymentType === "ON_SITE" ? clean(opts.paymentMissedReason) : null;
  if (toStatus === "DONE" && task.paymentType === "ON_SITE" && !opts.paymentConfirmed && !unpaidReason) {
    throw Errors.paymentRequired();
  }

  // Акты до 20:00 (решение Артёма 02.07): водитель, завершая актовую задачу БЕЗ приложенного акта,
  // обязан выбрать причину. Причина информационная — завершение не блокируется, кандидата KPI создаст
  // детектор независимо от неё. Диспетчера не спрашиваем (он «и есть офис», ведёт статусы за внешних).
  let actReason: string | null = null;
  if (toStatus === "DONE" && task.requiresSignedDoc && actor.role === "DRIVER") {
    const docs = await prisma.attachment.count({ where: { taskId, kind: "DOCUMENT" } });
    if (docs === 0) {
      actReason = clean(opts.actMissedReason);
      if (!actReason) throw Errors.actReasonRequired();
    }
  }

  // Взятие/возобновление работы (→IN_PROGRESS): требуется открытая смена + одна активная задача.
  // Задачи сотрудникам живут вне этих правил (решение Артёма 15.08.2026): смена — про рабочий день
  // водителя на маршруте, а работа в цехе идёт параллельно доставкам и по ходу дня переключается.
  const staffTask = task.kind === "STAFF";
  if (toStatus === "IN_PROGRESS" && task.assigneeId && !staffTask) {
    // Требование открытой смены — только когда ВОДИТЕЛЬ берёт СВОЮ задачу (решение Артёма 19.06.2026).
    // Диспетчер ведёт статусы за исполнителя (в т.ч. внешнего перевозчика без смены) — его не блокируем.
    // Внешний перевозчик (User.isExternal, 02.07) смен не ведёт — гейт к нему не применяется; признак
    // читается из БД, не из запроса, поэтому гейт штатных не ослабляется.
    if (actor.role === "DRIVER" && actor.id === task.assigneeId) {
      const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { isExternal: true } });
      if (!me?.isExternal) {
        const shift = await prisma.shift.findFirst({
          where: { driverId: task.assigneeId, status: { in: ["REQUESTED", "OPEN"] } },
          select: { id: true },
        });
        if (!shift) throw Errors.shiftRequired();
      }
    }
    // Одна активная задача (этап B): у исполнителя не больше одной задачи «В работе» одновременно.
    // Правило по assigneeId — работает и когда водитель берёт сам, и когда диспетчер ведёт за исполнителя.
    // Жёсткий запрет (Артём 20.07): занятость НАПАРНИКОМ в активной парной блокирует так же, как своя
    // активная. Пока парная лишь назначена (не IN_PROGRESS) — не блокирует.
    // Считаем только доставки: задача в цехе не должна мешать взять заявку — это разная работа,
    // и «одна активная» задумывалась как «водитель в один момент едет по одному адресу».
    const other = await prisma.task.findFirst({
      where: {
        OR: [{ assigneeId: task.assigneeId }, { coDriverId: task.assigneeId }],
        status: "IN_PROGRESS",
        kind: "DELIVERY",
        id: { not: taskId },
      },
      select: { number: true, coDriverId: true },
    });
    if (other) {
      throw other.coDriverId === task.assigneeId
        ? Errors.activePairTaskExists(other.number)
        : Errors.activeTaskExists(other.number);
    }
  }

  // Время события: момент действия на телефоне (офлайн) с проверкой достоверности, иначе — сервера.
  const at = resolveOccurredAt(opts.occurredAt);
  const data: Prisma.TaskUpdateInput = { status: toStatus };
  if (toStatus === "ON_HOLD") data.holdReason = reason;
  if (toStatus === "CANCELLED") data.cancelReason = reason;
  // Офлайн: completedAt = момент действия на телефоне (occurredAt), а не время досылки.
  if (toStatus === "DONE") data.completedAt = at;
  // Заявка числится днём фактического завершения (решение Артёма 14.07.2026): при закрытии не в
  // плановый день переносим scheduledDate на МСК-день completedAt — доска/календарь/списки покажут
  // её в дне закрытия (сводка и KPI уже считают по completedAt). Плановая дата остаётся в журнале.
  const completionDate = toStatus === "DONE" ? resolveCompletionDate(task.scheduledDate, at) : null;
  if (completionDate) data.scheduledDate = completionDate;
  // Факт оплаты при ON_SITE-завершении (№8): получено / не получено + причина — сохраняем на задаче.
  if (toStatus === "DONE" && task.paymentType === "ON_SITE") {
    data.paymentReceived = opts.paymentConfirmed === true;
    data.paymentMissedReason = opts.paymentConfirmed ? null : unpaidReason;
  }
  // Причина «завершил без акта» — снимок на задаче (как paymentMissedReason): детектор KPI дотянется
  // простым select, Милена увидит в note кандидата.
  if (actReason) data.actMissedReason = actReason;
  if (task.status === "ON_HOLD" && toStatus === "ASSIGNED") data.holdReason = null;
  // Свободная смена статуса диспетчером (24.07.2026, кейс №700): при выходе ИЗ терминального статуса
  // снимаем «отпечатки» завершения/отмены — иначе откатанная задача останется в отчётах/KPI как
  // выполненная (completedAt), с висящей отметкой оплаты, или с причиной отмены на вернувшейся в работу
  // заявке. Плановую дату (scheduledDate был перенесён на день завершения) не восстанавливаем — она
  // есть только в журнале; при нужде диспетчер перенесёт вручную кнопкой «Перенести».
  if (task.status === "DONE" && toStatus !== "DONE") {
    data.completedAt = null;
    data.paymentReceived = null;
    data.paymentMissedReason = null;
    data.actMissedReason = null;
  }
  if (task.status === "CANCELLED" && toStatus !== "CANCELLED") {
    data.cancelReason = null;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data, include: taskInclude });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: "status_change",
        fromStatus: task.status,
        toStatus,
        comment: reason ?? clean(opts.comment),
        lat: opts.lat ?? null,
        lng: opts.lng ?? null,
        at,
      },
    });
    // Перенос на день фактического завершения — отдельная отметка: в истории видно, что заявка
    // планировалась на другой день (плановая дата не теряется, журнал только на запись).
    if (completionDate) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "reschedule",
          comment: `Дата: ${formatDayRu(task.scheduledDate) ?? "без даты"} → ${formatDayRu(completionDate)} — день фактического завершения`,
          at,
        },
      });
    }
    // Оплата на месте подтверждена — отдельная неизменяемая отметка в журнал (PRD §5).
    if (toStatus === "DONE" && task.paymentType === "ON_SITE" && opts.paymentConfirmed) {
      const amount = opts.paymentAmount ?? task.paymentAmount ?? null;
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "payment_received",
          comment: amount != null ? `Деньги получены: ${amount} ₽` : "Деньги получены",
          lat: opts.lat ?? null,
          lng: opts.lng ?? null,
          at,
        },
      });
    }
    // Завершено без оплаты «на месте» (№8) — неизменяемая отметка с причиной: инфа не теряется,
    // диспетчер её видит. Без штрафа KPI (решение Артёма) — это просто факт в журнале и на задаче.
    if (toStatus === "DONE" && task.paymentType === "ON_SITE" && !opts.paymentConfirmed && unpaidReason) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "payment_unpaid",
          comment: `Деньги не получены: ${unpaidReason}`,
          lat: opts.lat ?? null,
          lng: opts.lng ?? null,
          at, // офлайн: момент действия на телефоне, не досылки
        },
      });
    }
    // Завершено без акта (акты до 20:00, 02.07) — неизменяемая отметка с причиной водителя.
    if (actReason) {
      await tx.taskEvent.create({
        data: {
          taskId,
          actorId: actor.id,
          kind: "act_missing_reason",
          comment: `Акт не приложен: ${actReason}`,
          lat: opts.lat ?? null,
          lng: opts.lng ?? null,
          at,
        },
      });
    }
    return updated;
  });
  // Отмена диспетчером → пуш водителю (PRD §7). Движение статуса вперёд самим водителем не шлём.
  if (toStatus === "CANCELLED") notifyTaskAssignee(result, "cancelled", actor.id);
  // Деньги компании (carrierCost) отдаём только тем, кто ведёт заявки (11.08.2026). Форма важна:
  // прежнее «роль === DRIVER ⇒ вырезать» отдавало сумму любой НОВОЙ роли по умолчанию — это ровно та
  // мина, о которой предупреждает ARCHITECTURE §6. Здесь, как и в getTaskById, — белый список.
  return isTaskManagerRole(actor.role) ? result : stripMoneyForDriver(result);
}

export async function rescheduleTask(
  taskId: string,
  newDate: string,
  actor: Actor,
  comment?: string | null,
): Promise<TaskListItem> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  // Порядок важен: изоляция ПЕРВЕЕ прочих проверок. Иначе по чужой архивной заявке вернулось бы
  // «Заявка в архиве» вместо 404 — и это подтвердило бы её существование постороннему.
  if (!canViewTask(actor, task)) throw Errors.notFound();
  assertNotArchived(task.archivedAt);

  const isAssignee = task.assigneeId !== null && task.assigneeId === actor.id;
  const verdict = checkTransition({ role: actor.role, isAssignee }, task.status, "RESCHEDULED");
  if (!verdict.ok) throw Errors.invalidTransition();

  const date = parseDate(newDate);
  if (!date) throw Errors.dateRequired();

  // «Перенесена» возвращает задачу в «Назначена» на новую дату (PRD §5), снимая паузу.
  const status: TaskStatus = task.assigneeId ? "ASSIGNED" : "NEW";

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { scheduledDate: date, status, holdReason: null },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: actor.id,
        kind: "reschedule",
        fromStatus: task.status,
        toStatus: status,
        comment: clean(comment) ?? `Перенесена на ${newDate}`,
      },
    });
    return updated;
  });
  notifyTaskAssignee(result, "rescheduled", actor.id);
  return result;
}

export async function addComment(
  taskId: string,
  text: string,
  actor: Actor,
  opts: { lat?: number | null; lng?: number | null; occurredAt?: string | null } = {},
): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound();
  const comment = clean(text);
  if (!comment) throw Errors.validation("Пустой комментарий");

  await prisma.taskEvent.create({
    data: {
      taskId,
      actorId: actor.id,
      kind: "comment",
      comment,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      at: resolveOccurredAt(opts.occurredAt), // офлайн: момент написания, не досылки
    },
  });
}

/**
 * Следующий номер задачи цеха из последовательности staff_task_number_seq (16.08.2026).
 * Последовательность, а не «max+1»: два диспетчера, ставящие задачи одновременно, иначе получили бы
 * один номер и упёрлись в уникальный индекс. nextval атомарен и не откатывается — «дырка» в
 * нумерации при откате транзакции безобиднее дубля.
 */
async function nextStaffNumber(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('staff_task_number_seq') AS nextval`;
  return Number(rows[0].nextval);
}

// Проверяет, что назначаемый — активный водитель. Возвращает его id.
async function assertAssignableDriver(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!u || u.role !== "DRIVER" || !u.isActive) {
    throw Errors.validation("Назначить можно только активного водителя");
  }
  return u.id;
}

/**
 * Исполнитель задачи сотрудникам — тот, кому выдан персональный доступ (staffTasksAccess).
 * Роль намеренно НЕ проверяем: сегодня это водители Александр и Николай, завтра — сотрудники цеха,
 * которых заведут тем же флагом. Право читается из БД, а не из запроса.
 */
async function assertAssignableStaff(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, staffTasksAccess: true },
  });
  if (!u || !u.isActive || !u.staffTasksAccess) {
    throw Errors.validation("Задачи сотрудникам можно ставить только тем, кому открыт этот доступ");
  }
  return u.id;
}

/** Кого можно поставить исполнителем в этом контуре. */
async function assertAssignableFor(kind: TaskKind, userId: string): Promise<string> {
  return kind === "STAFF" ? assertAssignableStaff(userId) : assertAssignableDriver(userId);
}
