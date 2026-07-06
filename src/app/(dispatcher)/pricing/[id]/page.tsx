import { redirect } from "next/navigation";
import { requireAnyRole } from "@/lib/session";
import { PRICING_ENABLED } from "@/lib/features";
import { PricingCardClient } from "./pricing-card-client";

// Компактный экран расценки (решение Артёма 24.06): из очереди /pricing открываем сразу блок цен,
// а не всю карточку задачи. Группа (dispatcher) и так под guard'ом layout'а — дублируем явной
// проверкой роли (defense in depth), данные клиент тянет через SWR (/api/tasks/:id, авторизуется внутри).
export const dynamic = "force-dynamic";

export default async function PricingCardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyRole("DISPATCHER", "ADMIN");
  // Раздел «Расценка» скрыт под флагом (06.07). Прямой заход по URL уводим на доску.
  if (!PRICING_ENABLED) redirect("/board");
  const { id } = await params;
  return <PricingCardClient taskId={id} />;
}
