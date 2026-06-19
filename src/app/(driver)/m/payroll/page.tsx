import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { periodOf } from "@/domain/kpi";
import { isPayrollDriver } from "@/domain/kpi-service";
import { DriverPayrollClient } from "./payroll-client";

export const dynamic = "force-dynamic";

// Экран водителя «Мой расчёт» (PRD §8): оклад, премия, мои нарушения, итог; переключатель месяца.
// Только просмотр, строго свои данные (driverId из сессии — см. /api/my/kpi).
export default async function DriverPayrollPage() {
  const user = await requireRole("DRIVER");
  // Водитель без денежного профиля (Николай и пр.) расчёт не ведёт — на главную, чтобы не показывать
  // пустой экран с нулями. Защита на сервере, не только скрытием ссылки (PRD §2, §8).
  if (!(await isPayrollDriver(user.id))) redirect("/m");
  return <DriverPayrollClient initialPeriod={periodOf(new Date())} />;
}
