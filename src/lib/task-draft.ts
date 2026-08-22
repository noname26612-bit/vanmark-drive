// Черновик формы создания заявки (доработка №1, 03.07.2026). Форма «Новая задача» закрывается тремя
// путями (клик мимо/Escape/крестик) и раньше молча теряла ввод. Теперь непустая форма при случайном
// закрытии СВОРАЧИВАЕТСЯ в черновик — плашка-чип внизу экрана, по клику форма открывается заново.
// Черновик живёт ТОЛЬКО на клиенте (localStorage): на сервер ничего не уходит до кнопки «Создать»,
// поэтому ни фантомных задач, ни номеров, ни записей в журнал — изоляция и правила проекта не задеты.
import type {
  MachineStatus,
  PassStatus,
  PaymentType,
  TaskMachineDirection,
} from "@/generated/prisma/enums";
import type { TaskDTO, TaskTypeDTO } from "./task-dto";
import { normalizeDirection, presetDirection } from "@/domain/task-machine-flow";
import { pickerLabel } from "./machine-ui";
import { taskNumberLabel } from "./task-number";

/**
 * Станок, выбранный в форме заявки (21.08.2026). `label` хранится вместе с id намеренно: черновик
 * лежит в localStorage и переживает перезагрузку, а показать чип «77-5 · ЛБМ 200» нужно сразу, не
 * дожидаясь ответа картотеки.
 */
export type DraftMachine = {
  machineId: string;
  direction: TaskMachineDirection;
  label: string;
};

// Состояние формы создания/редактирования задачи. Полностью сериализуемо (строки/булевы/enum) —
// кладётся в localStorage целиком без потерь.
export type FormState = {
  typeId: string;
  title: string;
  address: string;
  description: string;
  equipment: string;
  orgName: string;
  contactName: string;
  contactPhone: string;
  addressLink: string;
  invoiceNumber: string;
  paymentType: PaymentType;
  paymentAmount: string;
  paymentNote: string;
  scheduledDate: string;
  timeFrom: string;
  timeTo: string;
  timeNote: string;
  passStatus: PassStatus;
  priority: boolean;
  assigneeId: string;
  coDriverId: string; // напарник (20.07.2026, PRD §4); "" — нет. Старые черновики читаются с дефолтом ""
  requiresAct: boolean; // требование акта (дефолт из типа, диспетчер может снять)
  actWaivedNote: string; // причина снятия требования акта
  carrierCost: string; // стоимость поездки внешнего перевозчика, ₽ (этап 3; видна при внешнем исполнителе)
  // Станки заявки (21.08.2026, PRD §16.1). Поле аддитивное: версию DRAFTS_STORAGE_KEY НЕ поднимаем,
  // чтобы не выбросить живые черновики Милены — старые читаются с дефолтом [] (прецедент coDriverId).
  machines: DraftMachine[];
};

export function emptyForm(typeId: string, date: string, requiresAct: boolean): FormState {
  return {
    typeId,
    title: "",
    address: "",
    description: "",
    equipment: "",
    orgName: "",
    contactName: "",
    contactPhone: "",
    addressLink: "",
    invoiceNumber: "",
    paymentType: "NONE",
    paymentAmount: "",
    paymentNote: "",
    scheduledDate: date,
    timeFrom: "",
    timeTo: "",
    timeNote: "",
    passStatus: "NOT_NEEDED",
    priority: false,
    assigneeId: "",
    coDriverId: "",
    requiresAct,
    actWaivedNote: "",
    carrierCost: "",
    machines: [],
  };
}

// «Грязная» форма — есть содержательный пользовательский ввод, который стоит сохранить в черновик.
// Тип и дата заполнены по умолчанию (не считаем их вводом); учитываем текстовые поля и осознанные
// отклонения селектов/флагов от дефолтов. Пустую форму просто закрываем, не засоряя плашку черновиками.
export function isDirtyForm(form: FormState): boolean {
  const filledText = [
    form.title,
    form.address,
    form.description,
    form.equipment,
    form.orgName,
    form.contactName,
    form.contactPhone,
    form.addressLink,
    form.invoiceNumber,
    form.paymentAmount,
    form.paymentNote,
    form.timeFrom,
    form.timeTo,
    form.timeNote,
    form.actWaivedNote,
    form.carrierCost,
  ].some((v) => v.trim().length > 0);
  return (
    filledText ||
    form.assigneeId !== "" ||
    form.coDriverId !== "" ||
    // Выбранный станок — самый дорогой ввод в форме: его искали в картотеке, а то и заводили
    // карточку прямо отсюда. Терять такое при случайном закрытии нельзя.
    (form.machines ?? []).length > 0 ||
    form.priority ||
    form.paymentType !== "NONE" ||
    form.passStatus !== "NOT_NEEDED"
  );
}

// Короткая подпись черновика для чипа. Название → адрес → нейтральная заглушка.
export function draftLabel(form: FormState): string {
  return form.title.trim() || form.address.trim() || "Черновик заявки";
}

// Один свёрнутый черновик. id генерится на клиенте (crypto.randomUUID) при первом сворачивании.
export type TaskDraft = {
  id: string;
  form: FormState;
  savedAt: number; // время последнего сворачивания (для сортировки — свежие сверху)
  label: string;
};

// Версионированный ключ localStorage: при несовместимом изменении FormState поднимаем версию,
// чтобы не читать чужую форму старой раскладки.
export const DRAFTS_STORAGE_KEY = "vanmark:task-drafts:v1";

/**
 * Задача-источник для формы: строка списка (`TaskDTO`) и карточка (`TaskDetailDTO`) подходят обе.
 * Разница одна — у станка в карточке известно состояние, а в списке нет; от него зависит, какое
 * направление предложить копии, поэтому поле объявлено необязательным.
 */
export type CopySource = Omit<TaskDTO, "machines"> & {
  machines?: {
    machineId: string;
    direction: TaskMachineDirection;
    machine: {
      ourNumber: number | null;
      clientNumber: number | null;
      model: string;
      status?: MachineStatus;
    };
  }[];
};

/**
 * Форма из существующей задачи — правка (все поля как есть) и основа копии.
 * Живёт здесь, а не в модалке: копию собирают ещё и списки, а функция чистая и проверяется юнитами.
 */
export function formFromTask(t: CopySource): FormState {
  return {
    typeId: t.type.id,
    title: t.title,
    address: t.address,
    description: t.description ?? "",
    equipment: t.equipment ?? "",
    orgName: t.orgName ?? "",
    contactName: t.contactName ?? "",
    contactPhone: t.contactPhone ?? "",
    addressLink: t.addressLink ?? "",
    invoiceNumber: t.invoiceNumber ?? "",
    paymentType: t.paymentType,
    paymentAmount: t.paymentAmount === null ? "" : String(t.paymentAmount),
    paymentNote: t.paymentNote ?? "",
    scheduledDate: t.scheduledDate ? t.scheduledDate.slice(0, 10) : "",
    timeFrom: t.timeFrom ?? "",
    timeTo: t.timeTo ?? "",
    timeNote: t.timeNote ?? "",
    passStatus: t.passStatus,
    priority: t.priority,
    assigneeId: t.assigneeId ?? "",
    coDriverId: t.coDriverId ?? "",
    requiresAct: t.requiresSignedDoc,
    actWaivedNote: t.actWaivedNote ?? "",
    carrierCost: t.carrierCost == null ? "" : String(t.carrierCost),
    // Старые клиенты и офлайн-кэш поля не знают — читаем с дефолтом (прецедент taskKindOf).
    machines: (t.machines ?? []).map((m) => ({
      machineId: m.machineId,
      direction: m.direction,
      label: pickerLabel(m.machine),
    })),
  };
}

/** Результат сборки копии: форма + тип, который пришлось подменить (исходный выключен). */
export type CopyResult = {
  form: FormState;
  /** Название типа исходной заявки, если он выключен и заменён первым активным; иначе null. */
  replacedTypeName: string | null;
};

/**
 * Копия заявки (22.08.2026, решение Артёма): работа повторяется — тот же клиент, тот же адрес, тот
 * же станок, — а меняются день и исполнитель. Поэтому НЕ наследуются:
 *   • дата — ставим сегодня (копию заводят, чтобы съездить снова, а не задним числом);
 *   • исполнитель и напарник — назначает диспетчер осознанно, иначе копия молча уедет к тому же
 *     водителю, у которого сегодня может не быть смены;
 *   • стоимость поездки внешнего перевозчика — она про конкретного исполнителя, а его нет;
 *   • статус, история, фото, акты, ведомость, оценка и факт оплаты — их выдаёт сервер новой заявке.
 * Всё остальное (тип, суть, клиент, телефоны, адрес, счёт, оплата, окно, пропуск, срочность,
 * требование акта, станки) копируется — ради этого копию и делают.
 */
export function formForCopy(
  task: CopySource,
  { types, today }: { types: TaskTypeDTO[]; today: string },
): CopyResult {
  const base = formFromTask(task);
  // Тип могли выключить в админке уже после того, как заявку завели: форма с исчезнувшим типом
  // показала бы первый пункт списка, а отправила бы неактивный id. Подменяем явно и говорим об этом.
  const sourceType = types.find((t) => t.id === task.type.id) ?? null;
  const targetType = sourceType ?? types[0] ?? null;
  const flow = targetType?.machineFlow ?? "NONE";
  return {
    form: {
      ...base,
      typeId: targetType?.id ?? "",
      scheduledDate: today,
      assigneeId: "",
      coDriverId: "",
      carrierCost: "",
      // Направление предлагаем заново: станок за это время мог уехать к клиенту, и копия «везём»
      // на самом деле «забираем». Состояние известно только из карточки — в списке остаётся старое.
      machines: (task.machines ?? []).map((m) => ({
        machineId: m.machineId,
        label: pickerLabel(m.machine),
        direction: normalizeDirection(
          flow,
          m.machine.status ? presetDirection(m.machine.status) : m.direction,
        ),
      })),
    },
    replacedTypeName: sourceType ? null : (task.type.name ?? null),
  };
}

/** Заголовок модалки копии: «Копия заявки №615» / «Копия задачи Ц-5». */
export function copyTitle(task: CopySource): string {
  const staff = (task.kind ?? "DELIVERY") === "STAFF";
  return `${staff ? "Копия задачи" : "Копия заявки"} ${taskNumberLabel(task)}`;
}

/**
 * Строка-подсказка под заголовком копии. Называет источник и перечисляет ровно то, что копия НЕ
 * унаследовала или могла унаследовать зря, — чтобы дубль не уехал с чужой датой или чужой оплатой.
 */
export function copyHint(task: CopySource, replacedTypeName: string | null): string {
  const base = `Скопировано из ${(task.kind ?? "DELIVERY") === "STAFF" ? "задачи" : "заявки"} ${taskNumberLabel(task)} — проверьте дату, исполнителя и оплату.`;
  return replacedTypeName
    ? `${base} Тип «${replacedTypeName}» отключён — выберите тип заново.`
    : base;
}
