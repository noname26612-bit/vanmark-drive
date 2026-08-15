import { requireRole } from "@/lib/session";
import { isPayrollDriver } from "@/domain/kpi-service";
import { hasEquipmentAccess, isExternalDriver } from "@/domain/users";
import { DriverTasksClient } from "./tasks-client";

// «Мои задачи» водителя. Guard роли — в layout группы (driver); здесь подстраховываемся ещё раз.
export const dynamic = "force-dynamic";

export default async function DriverHomePage() {
  const user = await requireRole("DRIVER");
  // Ссылку «Мой расчёт» показываем только водителям с денежным профилем (Каширский/Писарев).
  // Николай и прочие штатные без профиля расчёт не ведут (PRD §2, §8).
  // Внешний перевозчик (02.07) смен не ведёт — блок смены ему не показываем (и сервер запрещает POST).
  // Доступ к оборудованию (15.08.2026): у Николая и Александра в приложении появляется вход в
  // «Листогибы» и «Фальцепрокатники». Признак — из БД, как и всё остальное про этого водителя.
  const [showPayroll, isExternal, showEquipment] = await Promise.all([
    isPayrollDriver(user.id),
    isExternalDriver(user.id),
    hasEquipmentAccess(user.id),
  ]);
  return (
    <DriverTasksClient
      showPayroll={showPayroll}
      showShift={!isExternal}
      showEquipment={showEquipment}
      meId={user.id}
    />
  );
}
