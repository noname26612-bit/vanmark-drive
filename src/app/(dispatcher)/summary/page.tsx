import { requireAnyRole } from "@/lib/session";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";
import { SummaryClient } from "./summary-client";

export const dynamic = "force-dynamic";

// Экран диспетчера «Сводка» (Фаза 2): управленческая картина по водителям за период
// (день/неделя/месяц) на основе уже накопленных данных. Доступен диспетчеру и админу.
export default async function SummaryPage() {
  await requireAnyRole("DISPATCHER", "ADMIN");
  return <SummaryClient initialAnchor={dateKeyInTz(new Date(), KPI_TZ)} />;
}
