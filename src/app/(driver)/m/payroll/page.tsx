import { requireRole } from "@/lib/session";
import { periodOf } from "@/domain/kpi";
import { DriverPayrollClient } from "./payroll-client";

export const dynamic = "force-dynamic";

// Экран водителя «Мой расчёт» (PRD §8): оклад, премия, мои нарушения, итог; переключатель месяца.
// Только просмотр, строго свои данные (driverId из сессии — см. /api/my/kpi).
export default async function DriverPayrollPage() {
  await requireRole("DRIVER");
  return <DriverPayrollClient initialPeriod={periodOf(new Date())} />;
}
