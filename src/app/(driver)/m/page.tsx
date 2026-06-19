import { requireRole } from "@/lib/session";
import { isPayrollDriver } from "@/domain/kpi-service";
import { DriverTasksClient } from "./tasks-client";

// «Мои задачи» водителя. Guard роли — в layout группы (driver); здесь подстраховываемся ещё раз.
export const dynamic = "force-dynamic";

export default async function DriverHomePage() {
  const user = await requireRole("DRIVER");
  // Ссылку «Мой расчёт» показываем только водителям с денежным профилем (Каширский/Писарев).
  // Николай и прочие штатные без профиля расчёт не ведут (PRD §2, §8).
  const showPayroll = await isPayrollDriver(user.id);
  return <DriverTasksClient showPayroll={showPayroll} />;
}
