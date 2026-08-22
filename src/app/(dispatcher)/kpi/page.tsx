import { requireAnyRole } from "@/lib/session";
import { periodOf } from "@/domain/kpi";
import { KpiClient } from "./kpi-client";

export const dynamic = "force-dynamic";

/** Расчётный месяц вида «2026-07»; месяц 01–12. Всё прочее — не период. */
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Экран Милены «KPI / Зарплата» (PRD §8 экран 6): кандидаты в нарушения, расчёт по водителям,
// ручные отметки, закрытие месяца. Доступен диспетчеру и админу.
//
// `?period=YYYY-MM` (22.08.2026) — вход из плашки «Расчёт за … не закрыт» на «Управлении»: экран
// открывается сразу на нужном месяце. Мусор в параметре — текущий месяц, не ошибка.
export default async function KpiPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  await requireAnyRole("DISPATCHER", "ADMIN");
  const { period } = await searchParams;
  const raw = Array.isArray(period) ? period[0] : period;
  const initialPeriod = raw && PERIOD_RE.test(raw) ? raw : periodOf(new Date());
  return <KpiClient initialPeriod={initialPeriod} />;
}
