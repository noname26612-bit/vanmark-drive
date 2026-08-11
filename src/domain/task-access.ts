// Кто ведёт ЗАЯВКИ (ARCHITECTURE §6, решение Артёма 11.08.2026). Белый список ролей — по образцу
// machine-access.ts, никогда «все кроме водителя».
//
// Зачем отдельный предикат. До 11.08.2026 весь штаб держался на одном `isDispatcherRole`
// (ADMIN|DISPATCHER): им были закрыты и заявки, и смены, и KPI, и деньги. Менеджеру-сервиснику
// (Максиму) открыли работу с заявками, но НЕ смены, KPI/нарушения, сводку и админку — значит
// одного списка мало, и права расщеплены на два:
//
//   isTaskManagerRole  — заявки: создать, править, назначить, перенести, отменить, архивировать.
//   isDispatcherRole   — смены, KPI и нарушения, пометки простоя, сводка, расценка, админка.
//
// Правило при вводе следующей роли: добавлять её в НУЖНЫЙ список явно, а не ослаблять проверки.
import type { Role } from "@/generated/prisma/enums";
import { Errors } from "./errors";

/** Роли, которые ведут заявки: диспетчер (Милена), админ/директор, менеджер-сервисник (Максим). */
export function isTaskManagerRole(role: Role): boolean {
  return role === "ADMIN" || role === "DISPATCHER" || role === "SERVICE_MANAGER";
}

/** Гейт для доменных функций: не ведёт заявки — 403 (существование задач не секрет, в отличие от станков). */
export function assertTaskManager(actor: { role: Role }): void {
  if (!isTaskManagerRole(actor.role)) throw Errors.forbidden();
}
