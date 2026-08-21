// Автоматика по станку при завершении заявки (этап 2 модуля оборудования, 21.08.2026, PRD §16.1).
// Чистые функции без prisma — вся таблица правил проверяется юнит-тестами.
//
// ЗАЧЕМ ЭТОТ МОДУЛЬ. До сих пор перемещения станков вели руками в двух местах: водитель закрывал
// заявку, а кто-то отдельно переводил карточку станка в «Продан»/«В аренде». Это осознанный
// временный дубль, который здесь убирается: тип заявки знает, что происходит со станком, и при
// завершении система делает это сама.
//
// ПОЧЕМУ ПРАВИЛО ЖИВЁТ НА ТИПЕ, А НЕ В ИМЕНИ. Название типа правит админ в /admin/task-types.
// Матчинг по строке («если тип называется "Доставка проданного об."…») отвалился бы молча после
// первого же переименования — поэтому правило хранится колонкой TaskType.machineFlow.
//
// НАПРАВЛЕНИЕ. Три типа двунаправленные по смыслу («Доставка / забор из аренды» — это и «туда», и
// «обратно»), поэтому направление хранится на СВЯЗИ и выбирается человеком в форме. У остальных
// оно однозначно и нормализуется сервером принудительно (см. forcedDirection).
import type { MachineFlow, MachineStatus, TaskMachineDirection } from "@/generated/prisma/enums";

export const MACHINE_FLOWS: readonly MachineFlow[] = [
  "NONE",
  "SOLD_DELIVERY",
  "RENTAL",
  "REPAIR_RETURN",
  "PURCHASE",
  "CARRIER",
] as const;

/** Подпись правила в админке типов. Формулировки — «что произойдёт», а не имя enum. */
export const MACHINE_FLOW_LABEL: Record<MachineFlow, string> = {
  NONE: "Ничего не делать",
  SOLD_DELIVERY: "Продажа с доставкой",
  RENTAL: "Аренда: выдача и возврат",
  REPAIR_RETURN: "Ремонт: выдача и приём",
  PURCHASE: "Закупка / выкуп станка",
  CARRIER: "Отправка и получение через ТК",
};

/** Пояснение под подписью: что именно сделает система при завершении заявки. */
export const MACHINE_FLOW_HINT: Record<MachineFlow, string> = {
  NONE: "Станок можно привязать к заявке — состояние карточки система не меняет",
  SOLD_DELIVERY: "При завершении станок и его комплект переходят в «Продан», склад списывается",
  RENTAL: "Везём клиенту → «В аренде»; забираем к нам → «Готов» (отметки нужны заново)",
  REPAIR_RETURN: "Везём клиенту → «Выдан клиенту»; забираем к нам → «Требует ремонта»",
  PURCHASE: "Заполнит «кто привёз» и дату поступления. Состояние не меняется",
  CARRIER: "Отправка → «Продан», если станок стоит на продажу; получение — как закупка",
};

export const TASK_MACHINE_DIRECTION_LABEL: Record<TaskMachineDirection, string> = {
  OUT: "Везём клиенту",
  IN: "Забираем к нам",
};

/**
 * Что делает автоматика с одним станком.
 *
 * • `status` — перевести станок (и его комплект) в это состояние существующим `applyStatusChangeTx`.
 * • `arrival` — заполнить «кто привёз» и дату поступления, если они ещё пусты. Состояние не трогаем:
 *   что с выкупленным станком делать дальше, решают на площадке (диагностика, ремонт, продажа).
 * • `soldIfOnSale` — «Продан», но только если станок стоит на продажу. Через ТК уезжает и чужое
 *   железо (вернули клиенту после ремонта) — продавать его нельзя, поэтому только заметка в журнал.
 * • `none` — только связь и записи в журналах.
 */
export type FlowEffect =
  | { kind: "none" }
  | { kind: "status"; status: MachineStatus }
  | { kind: "arrival" }
  | { kind: "soldIfOnSale" };

/**
 * Направление, которое тип задаёт жёстко, или null — направление выбирает человек.
 * Проданное всегда уезжает, выкупленное всегда приезжает: спрашивать тут не о чем.
 */
export function forcedDirection(flow: MachineFlow): TaskMachineDirection | null {
  if (flow === "SOLD_DELIVERY") return "OUT";
  if (flow === "PURCHASE") return "IN";
  return null;
}

/** Двунаправленный тип — сегмент «Везём клиенту | Забираем к нам» показывается только у них. */
export function isBidirectionalFlow(flow: MachineFlow): boolean {
  return flow === "RENTAL" || flow === "REPAIR_RETURN" || flow === "CARRIER";
}

/**
 * Направление, предложенное по текущему состоянию станка. Станок у клиента (в аренде, выдан,
 * продан) — очевидно, его забирают; всё, что стоит на площадке, — очевидно, везут. Предположение
 * мягкое: человек перещёлкивает сегмент одним тапом.
 */
export function presetDirection(status: MachineStatus): TaskMachineDirection {
  return status === "RENTED" || status === "RELEASED" || status === "SOLD" ? "IN" : "OUT";
}

/** Направление с учётом жёсткого правила типа — единственная точка нормализации. */
export function normalizeDirection(
  flow: MachineFlow,
  direction: TaskMachineDirection,
): TaskMachineDirection {
  return forcedDirection(flow) ?? direction;
}

/**
 * Таблица автоматики — истина для кода и тестов (план 21.08.2026).
 * Направление нормализуется здесь же: у однонаправленных типов пришедшее значение не важно.
 */
export function flowEffect(flow: MachineFlow, direction: TaskMachineDirection): FlowEffect {
  const dir = normalizeDirection(flow, direction);
  switch (flow) {
    case "SOLD_DELIVERY":
      return { kind: "status", status: "SOLD" };
    case "RENTAL":
      return { kind: "status", status: dir === "OUT" ? "RENTED" : "READY" };
    case "REPAIR_RETURN":
      return { kind: "status", status: dir === "OUT" ? "RELEASED" : "NEEDS_REPAIR" };
    case "PURCHASE":
      return { kind: "arrival" };
    case "CARRIER":
      return dir === "OUT" ? { kind: "soldIfOnSale" } : { kind: "arrival" };
    case "NONE":
      return { kind: "none" };
    default: {
      // Добавили значение в enum и забыли правило — упадёт типизация здесь, а не в проде.
      const exhaustive: never = flow;
      return exhaustive;
    }
  }
}

/** Меняет ли тип состояние станка вообще — для подписей в интерфейсе («автоматика: —»). */
export function flowTouchesStatus(flow: MachineFlow): boolean {
  return flow === "SOLD_DELIVERY" || flow === "RENTAL" || flow === "REPAIR_RETURN" || flow === "CARRIER";
}
