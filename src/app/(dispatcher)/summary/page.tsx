import { requireAnyRole } from "@/lib/session";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";
import { parseSummaryParams } from "@/lib/summary-url";
import { SummaryClient } from "./summary-client";

export const dynamic = "force-dynamic";

// Экран диспетчера «Сводка» (Фаза 2): управленческая картина по водителям за период
// (день/неделя/месяц) на основе уже накопленных данных. Доступен диспетчеру и админу.
//
// Период приходит адресом (`?g=week&d=2026-08-17`, v3): ссылку на конкретный период можно
// отправить, а F5 не сбрасывает выбранное. Мусор в параметрах — период по умолчанию, не 500.
export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string | string[]; d?: string | string[] }>;
}) {
  await requireAnyRole("DISPATCHER", "ADMIN");
  const todayKey = dateKeyInTz(new Date(), KPI_TZ);
  const { granularity, day } = parseSummaryParams(await searchParams, todayKey);
  return <SummaryClient initialGranularity={granularity} initialDay={day} todayKey={todayKey} />;
}
