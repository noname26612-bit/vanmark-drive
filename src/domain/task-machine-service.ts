// Связь заявок со станками и автоматика при завершении (этап 2 модуля оборудования, 21.08.2026,
// PRD §16.1). Живёт отдельным модулем, а не в task-service.ts: тот и так на полторы тысячи строк,
// а здесь своя тема — картотека, комплекты и журнал станка.
//
// Три обязанности:
//   1) пикер станков для формы заявки (listPickerMachines);
//   2) полный набор связей заявки атомарно, с записями в ОБА журнала (setTaskMachinesTx);
//   3) автоматика после завершения заявки (applyMachineAutomationAfterDone).
//
// ГЛАВНОЕ ПРАВИЛО АВТОМАТИКИ (решение Артёма): она НИКОГДА не блокирует завершение задачи
// водителем. Поэтому она запускается ПОСЛЕ коммита DONE, отдельной короткой транзакцией на каждый
// станок, и целиком завёрнута в try/catch. Что не получилось — уходит заметкой в журналы, а не
// ошибкой водителю; диспетчер видит запись и дожимает руками кнопками карточки.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  EquipmentFamily,
  MachineCategory,
  MachineFlow,
  MachineStatus,
  TaskMachineDirection,
} from "@/generated/prisma/enums";
import { Errors } from "./errors";
import { assertMachineAccess } from "./machine-access";
import { formatMachineNumber } from "./machine-number";
import {
  MACHINE_STATUS_LABEL,
  categoriesFollowingStatus,
  categoriesLabel,
  isArchivedStatus,
  isStatusAllowedForCategories,
  isStockKind,
} from "./machine-status";
import {
  applyStatusWithKitTx,
  loadKitForTransfer,
  type Actor,
  type TransferLink,
} from "./machine-service";
import { TASK_MACHINE_DIRECTION_LABEL, flowEffect, normalizeDirection } from "./task-machine-flow";
import { KPI_TZ, dateKeyInTz } from "./kpi";
import { machineMatches, parseQuery } from "@/lib/machine-search";
import type { MachinePickerItem } from "@/lib/machine-dto";

/**
 * Потолок числа станков в одной заявке. Артём сказал «обычно один, иногда несколько» — двадцать
 * с огромным запасом покрывает реальность и закрывает вырожденный запрос с тысячей строк.
 */
const MAX_MACHINES_PER_TASK = 20;

/** Станок, как его просит форма заявки. */
export type WantedMachine = { machineId: string; direction: TaskMachineDirection };

/** Проверенная связь: станок существует, годится к привязке, направление нормализовано типом. */
export type ResolvedMachineLink = {
  machineId: string;
  direction: TaskMachineDirection;
  /** «77-5 (ЛБМ 200)» — подпись для журналов. Считается один раз, здесь. */
  label: string;
};

type NumberedModel = { ourNumber: number | null; clientNumber: number | null; model: string };

/** Подпись станка в журналах: «77-5 (ЛБМ 200)» или просто модель, если номера нет. */
function machineLabel(m: NumberedModel): string {
  const number = formatMachineNumber(m);
  return number ? `${number} (${m.model})` : m.model;
}

/** Подпись заявки в журнале станка: «№615 (Доставка / забор из аренды)». */
function taskLabel(task: { number: number; typeName: string }): string {
  return `№${task.number} (${task.typeName})`;
}

// ───────────────────────────────── пикер ─────────────────────────────────

/**
 * Станки для выбора в форме заявки. Отдаём раздел целиком (десятки карточек) — клиент фильтрует
 * и ищет мгновенно тем же движком, что и картотека.
 *
 * Что НЕ показываем: аннулированные карточки (их не возят) и складские остатки — размотчик или
 * частотник едет как часть комплекта головного, а не отдельной строкой заявки. Ножи и фальц
 * машинки привязывать МОЖНО: их продают и отдельно.
 *
 * Показываем и архивные (продан/выдан) с «в аренде» — именно их и забирают обратно.
 */
export async function listPickerMachines(
  actor: Actor,
  family: EquipmentFamily,
  q?: string,
): Promise<MachinePickerItem[]> {
  assertMachineAccess(actor);
  const rows = await prisma.machine.findMany({
    where: {
      family,
      status: { not: "VOIDED" },
      kind: { notIn: ["UNCOILER", "INVERTER"] },
    },
    select: {
      id: true,
      ourNumber: true,
      clientNumber: true,
      family: true,
      kind: true,
      model: true,
      configuration: true,
      status: true,
      categories: true,
      invoice1C: true,
      diagnosedAt: true,
      lastVerifiedAt: true,
    },
    orderBy: [
      { ourNumber: { sort: "asc", nulls: "last" } },
      { clientNumber: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
  });

  const items: MachinePickerItem[] = rows.map((m) => ({
    id: m.id,
    ourNumber: m.ourNumber,
    clientNumber: m.clientNumber,
    family: m.family,
    kind: m.kind,
    model: m.model,
    configuration: m.configuration,
    status: m.status,
    categories: m.categories,
    invoice1C: m.invoice1C,
    // Условие один в один с янтарным баннером карточки: у станка в аренде и в архиве отметок
    // не спрашивают — он не на площадке.
    marksUnset:
      !isArchivedStatus(m.status) &&
      m.status !== "RENTED" &&
      (m.diagnosedAt === null || m.lastVerifiedAt === null),
  }));

  const query = parseQuery(q ?? "");
  return query.active ? items.filter((m) => machineMatches(m, query)) : items;
}

// ───────────────────────────────── связи ─────────────────────────────────

/**
 * Проверить набор станков и нормализовать направления. Читается ДО транзакции: походы в базу за
 * карточками не должны держать блокировки, а отказ должен приходить раньше, чем создана заявка.
 *
 * Гейт картотеки стоит здесь ЯВНО, хотя вызывающий (createTask/updateTaskFields) уже проверил
 * право вести заявки. Сегодня оба белых списка совпадают роль в роль, но полагаться на это —
 * ровно та мина, о которой предупреждает ARCHITECTURE §6: стоит появиться роли, которая ведёт
 * заявки без доступа к оборудованию, и она перебирала бы карточки по текстам ошибок.
 */
export async function resolveTaskMachines(
  actor: Actor,
  wanted: readonly WantedMachine[],
  flow: MachineFlow,
): Promise<ResolvedMachineLink[]> {
  assertMachineAccess(actor);
  if (wanted.length === 0) return [];
  if (wanted.length > MAX_MACHINES_PER_TASK) {
    throw Errors.validation(`В одну заявку нельзя привязать больше ${MAX_MACHINES_PER_TASK} станков`);
  }
  const ids = wanted.map((w) => w.machineId);
  const rows = await prisma.machine.findMany({
    where: { id: { in: ids } },
    select: { id: true, ourNumber: true, clientNumber: true, model: true, kind: true, status: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return wanted.map((w) => {
    const m = byId.get(w.machineId);
    if (!m) throw Errors.validation("Станок не найден — обновите список и выберите заново");
    if (m.status === "VOIDED") {
      throw Errors.validation(`Станок ${machineLabel(m)} аннулирован — привязать его нельзя`);
    }
    if (isStockKind(m.kind)) {
      throw Errors.validation(
        `${machineLabel(m)} — складской остаток: он едет в составе комплекта, отдельно его не привязывают`,
      );
    }
    return {
      machineId: m.id,
      direction: normalizeDirection(flow, w.direction),
      label: machineLabel(m),
    };
  });
}

/**
 * Привести связи заявки к переданному набору (семантика «полный набор атомарно», как
 * changeCategories у станка). Диффом, а не «удалить всё и создать заново»: у существующих связей
 * на себе живёт отметка сработавшей автоматики (appliedAt) — пересоздание сбросило бы её, и
 * повторное завершение продало бы станок второй раз.
 *
 * Каждое изменение уходит в ОБА журнала: заявка помнит, что к ней прицепили, карточка станка —
 * по какой заявке её везли.
 */
export async function setTaskMachinesTx(
  tx: Prisma.TransactionClient,
  task: { id: string; number: number; typeName: string },
  wanted: readonly ResolvedMachineLink[],
  actorId: string,
): Promise<void> {
  const existing = await tx.taskMachine.findMany({
    where: { taskId: task.id },
    select: { machineId: true, direction: true },
  });
  const existingById = new Map(existing.map((e) => [e.machineId, e]));
  const wantedById = new Map(wanted.map((w) => [w.machineId, w]));

  for (const link of wanted) {
    const before = existingById.get(link.machineId);
    if (before === undefined) {
      await tx.taskMachine.create({
        data: {
          taskId: task.id,
          machineId: link.machineId,
          direction: link.direction,
          createdById: actorId,
        },
      });
      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          actorId,
          kind: "machine_link",
          comment: `Привязан станок ${link.label} — ${TASK_MACHINE_DIRECTION_LABEL[link.direction].toLowerCase()}`,
        },
      });
      await tx.machineEvent.create({
        data: {
          machineId: link.machineId,
          actorId,
          kind: "task_link",
          comment: `Заявка ${taskLabel(task)} — ${TASK_MACHINE_DIRECTION_LABEL[link.direction].toLowerCase()}`,
        },
      });
      continue;
    }
    if (before.direction === link.direction) continue;
    await tx.taskMachine.update({
      where: { taskId_machineId: { taskId: task.id, machineId: link.machineId } },
      data: { direction: link.direction },
    });
    const change = `${TASK_MACHINE_DIRECTION_LABEL[before.direction]} → ${TASK_MACHINE_DIRECTION_LABEL[link.direction]}`;
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        actorId,
        kind: "machine_link",
        comment: `Станок ${link.label}: ${change}`,
      },
    });
    await tx.machineEvent.create({
      data: {
        machineId: link.machineId,
        actorId,
        kind: "task_link",
        comment: `Заявка ${taskLabel(task)}: ${change}`,
      },
    });
  }

  for (const gone of existing) {
    if (wantedById.has(gone.machineId)) continue;
    const m = await tx.machine.findUnique({
      where: { id: gone.machineId },
      select: { ourNumber: true, clientNumber: true, model: true },
    });
    const label = m ? machineLabel(m) : "станок";
    await tx.taskMachine.delete({
      where: { taskId_machineId: { taskId: task.id, machineId: gone.machineId } },
    });
    await tx.taskEvent.create({
      data: { taskId: task.id, actorId, kind: "machine_unlink", comment: `Отвязан станок ${label}` },
    });
    await tx.machineEvent.create({
      data: {
        machineId: gone.machineId,
        actorId,
        kind: "task_unlink",
        comment: `Заявка ${taskLabel(task)}`,
      },
    });
  }
}

// ───────────────────────────────── автоматика ─────────────────────────────────

/** Фамилия из полного имени: «Алексей Каширский» → «Каширский». Одно слово оставляем как есть. */
function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name.trim();
}

type AutoTask = {
  id: string;
  number: number;
  typeName: string;
  flow: MachineFlow;
  completedAt: Date;
  /** Кем помечать поступление станка при закупке: ответственный водитель, иначе — кто завершил. */
  deliveredBy: string;
};

type AutoMachine = {
  id: string;
  ourNumber: number | null;
  clientNumber: number | null;
  model: string;
  status: MachineStatus;
  categories: MachineCategory[];
  deliveredBy: string | null;
  arrivedAt: Date | null;
};

/**
 * Автоматика после успешного завершения заявки (DONE). Вызывается ПОСЛЕ коммита транзакции задачи.
 *
 * Почему не внутри общей транзакции:
 *  (а) «никогда не блокировать водителя» гарантировано только когда DONE уже зафиксирован;
 *  (б) проглоченная внутри транзакции ошибка оставила бы частичные записи;
 *  (в) все пути DONE (водитель, диспетчер, офлайн-досылка) идут через transitionTask, а
 *      withIdempotency кэширует ответ — повтор офлайн-очереди автоматику не перезапустит.
 *
 * Окно «сервер упал между коммитом DONE и автоматикой» принято как риск: пользователей трое,
 * журнал показывает всё, диспетчер дожмёт кнопками карточки.
 *
 * ПРО ПРАВА. Здесь НЕТ assertMachineAccess, и это осознанно: карточку двигает не человек, а
 * система — по связи, которую поставил допущенный к картотеке диспетчер, и по правилу, которое
 * задал админ в справочнике типов. Водитель картотеку по-прежнему не видит и напрямую в неё не
 * пишет: его единственный вход сюда — завершение СВОЕЙ задачи (изоляция проверена в transitionTask
 * до коммита). actor нужен только чтобы подписать события журналов настоящим автором действия.
 */
export async function applyMachineAutomationAfterDone(taskId: string, actor: Actor): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        number: true,
        completedAt: true,
        assignee: { select: { name: true } },
        type: { select: { name: true, machineFlow: true } },
        machines: {
          // Идемпотентность: связь обрабатывается ровно один раз. Откат DONE отметку не снимает,
          // поэтому повторное завершение не продаёт станок и не списывает склад заново.
          where: { appliedAt: null },
          select: { machineId: true, direction: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!task || task.machines.length === 0) return;
    const flow = task.type.machineFlow;
    if (flow === "NONE") return; // тип автоматики не задаёт — связь и журналы уже на месте

    const actorUser = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true },
    });
    const auto: AutoTask = {
      id: task.id,
      number: task.number,
      typeName: task.type.name,
      flow,
      completedAt: task.completedAt ?? new Date(),
      deliveredBy: surnameOf(task.assignee?.name ?? actorUser?.name ?? ""),
    };

    for (const link of task.machines) {
      // Каждый станок — в своём try/catch: сбой на одном не должен лишить остальных автоматики.
      try {
        await applyOneLink(auto, link.machineId, link.direction, actor.id);
      } catch (e) {
        console.error("machine automation: станок пропущен", {
          taskId,
          machineId: link.machineId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e) {
    // Внешний барьер: что бы ни случилось, DONE уже зафиксирован и водитель не заблокирован.
    console.error("machine automation: сбой", {
      taskId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function applyOneLink(
  task: AutoTask,
  machineId: string,
  direction: TaskMachineDirection,
  actorId: string,
): Promise<void> {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: {
      id: true,
      ourNumber: true,
      clientNumber: true,
      model: true,
      status: true,
      categories: true,
      deliveredBy: true,
      arrivedAt: true,
    },
  });
  if (!machine) return; // карточку удалили между завершением и автоматикой — писать некуда
  const effect = flowEffect(task.flow, direction);

  if (effect.kind === "none") return;

  if (effect.kind === "arrival") {
    await markArrival(task, machine, actorId);
    return;
  }

  if (effect.kind === "soldIfOnSale") {
    // Через ТК уезжает и чужое железо (вернули клиенту после ремонта) — продавать его нельзя.
    // Поэтому «Продан» ставим строго тому, что стоит на продажу; остальному — заметка в журнал.
    if (!machine.categories.includes("OUR_SALE")) {
      await noteOnly(
        task,
        machine,
        actorId,
        `Отправлен через ТК по заявке №${task.number} — состояние не менялось (станок не стоит на продажу)`,
        `Станок ${machineLabel(machine)} отправлен через ТК — состояние не менялось (не стоит на продажу)`,
        true,
      );
      return;
    }
    await applyStatus(task, machine, "SOLD", actorId);
    return;
  }

  await applyStatus(task, machine, effect.status, actorId);
}

/** Перевод состояния станка вместе с комплектом — тем же кодом, что и кнопки карточки. */
async function applyStatus(
  task: AutoTask,
  machine: AutoMachine,
  toStatus: MachineStatus,
  actorId: string,
): Promise<void> {
  const label = machineLabel(machine);

  // Станок уже там, куда его вело бы правило — отмечаем связь обработанной и не шумим в журнале.
  if (machine.status === toStatus) {
    await prisma.taskMachine.update({
      where: { taskId_machineId: { taskId: task.id, machineId: machine.id } },
      data: { appliedStatus: toStatus, appliedAt: new Date() },
    });
    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        actorId,
        kind: "machine_auto",
        comment: `Станок ${label} уже в состоянии «${MACHINE_STATUS_LABEL[toStatus]}»`,
      },
    });
    return;
  }

  // Та же проверка, что у кнопок карточки (assertStatusAllowed): своё железо дописывает или
  // заменяет себе категорию само, чужое — нет. Несовпадение здесь не ошибка водителя, а
  // расхождение картотеки с заявкой: пишем заметку и оставляем связь необработанной, чтобы
  // повторное завершение после правки категорий её добило.
  if (
    !isStatusAllowedForCategories(machine.categories, toStatus) &&
    categoriesFollowingStatus(machine.categories, toStatus) === null
  ) {
    await noteOnly(
      task,
      machine,
      actorId,
      `Заявка №${task.number} завершена, но «${MACHINE_STATUS_LABEL[toStatus]}» не подходит категориям «${categoriesLabel(machine.categories)}» — состояние не изменено`,
      `Станок ${label}: «${MACHINE_STATUS_LABEL[toStatus]}» не подходит категориям «${categoriesLabel(machine.categories)}» — состояние не изменено`,
      false,
    );
    return;
  }

  // Комплект едет всегда (решение Артёма): галочки, как у ручной смены состояния, здесь нет —
  // станок уехал целиком. Несовместимая комплектующая роняет загрузку — ловим и пропускаем станок.
  let kit: TransferLink[];
  try {
    kit = await loadKitForTransfer(machine.id, toStatus);
  } catch (e) {
    const why = e instanceof Error ? e.message : "комплект не удалось перевести";
    await noteOnly(
      task,
      machine,
      actorId,
      `Заявка №${task.number} завершена, но комплект перевести не удалось: ${why} — состояние не изменено`,
      `Станок ${label}: комплект перевести не удалось (${why}) — состояние не изменено`,
      false,
    );
    return;
  }

  const reason = `по заявке №${task.number}`;
  await prisma.$transaction(async (tx) => {
    await applyStatusWithKitTx(
      tx,
      { id: machine.id, status: machine.status, categories: machine.categories },
      toStatus,
      reason,
      actorId,
      kit,
    );
    await tx.taskMachine.update({
      where: { taskId_machineId: { taskId: task.id, machineId: machine.id } },
      data: { appliedStatus: toStatus, appliedAt: new Date() },
    });
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        actorId,
        kind: "machine_auto",
        comment: `Станок ${label} → ${MACHINE_STATUS_LABEL[toStatus]}`,
      },
    });
  });
}

/**
 * Закупка/выкуп и получение через ТК: отмечаем, кто привёз станок и когда он появился на площадке.
 * Состояние не трогаем — что делать с выкупленным станком, решают на месте (диагностика, ремонт,
 * продажа). Уже заполненные поля не перетираем: ручной ввод человека главнее догадки системы.
 */
async function markArrival(task: AutoTask, machine: AutoMachine, actorId: string): Promise<void> {
  const label = machineLabel(machine);
  const dayKey = dateKeyInTz(task.completedAt, KPI_TZ); // МСК-день завершения, а не UTC
  const patch: { deliveredBy?: string; arrivedAt?: Date } = {};
  if (!machine.deliveredBy && task.deliveredBy) patch.deliveredBy = task.deliveredBy;
  if (!machine.arrivedAt) patch.arrivedAt = new Date(`${dayKey}T00:00:00.000Z`);

  const changes = [
    ...(patch.deliveredBy
      ? [{ field: "deliveredBy", label: "Кто привёз", from: null, to: patch.deliveredBy }]
      : []),
    ...(patch.arrivedAt ? [{ field: "arrivedAt", label: "Поступил", from: null, to: dayKey }] : []),
  ];

  await prisma.$transaction(async (tx) => {
    if (changes.length > 0) {
      await tx.machine.update({ where: { id: machine.id }, data: patch });
      await tx.machineEvent.create({
        data: {
          machineId: machine.id,
          actorId,
          kind: "edit",
          changes,
          comment: `Поступление отмечено по заявке №${task.number}`,
        },
      });
    }
    await tx.taskMachine.update({
      where: { taskId_machineId: { taskId: task.id, machineId: machine.id } },
      data: { appliedAt: new Date() },
    });
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        actorId,
        kind: "machine_auto",
        comment:
          changes.length > 0
            ? `Станок ${label}: отмечено поступление`
            : `Станок ${label}: поступление уже было отмечено`,
      },
    });
  });
}

/**
 * Автоматика ничего не поменяла — но сказать об этом обязана: заметка уходит и в журнал станка
 * (её видно в «Комментариях» карточки), и в историю заявки.
 *
 * `applied` различает две ситуации: `true` — так и задумано (через ТК уехало не наше железо),
 * связь закрыта; `false` — расхождение, которое человек может починить, поэтому `appliedAt` не
 * ставим и повторное завершение попробует ещё раз.
 */
async function noteOnly(
  task: AutoTask,
  machine: AutoMachine,
  actorId: string,
  machineNote: string,
  taskNote: string,
  applied: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.machineEvent.create({
      data: { machineId: machine.id, actorId, kind: "comment", comment: machineNote },
    });
    if (applied) {
      await tx.taskMachine.update({
        where: { taskId_machineId: { taskId: task.id, machineId: machine.id } },
        data: { appliedAt: new Date() },
      });
    }
    await tx.taskEvent.create({
      data: { taskId: task.id, actorId, kind: "machine_auto", comment: taskNote },
    });
  });
}
