import { redirect } from "next/navigation";
import { requireAnyRole } from "@/lib/session";
import { PRICING_ENABLED } from "@/lib/features";
import { PricingQueueClient } from "./pricing-queue-client";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  // Расценка ведомостей — деньги, значит диспетчерский контур (11.08.2026): layout сюда пускает и
  // менеджера-сервисника, поэтому у страницы обязан быть свой guard. Без него включение флага
  // молча открыло бы ему цены.
  await requireAnyRole("DISPATCHER", "ADMIN");
  // Раздел «Расценка» скрыт под флагом (06.07). Прямой заход по URL уводим на доску.
  if (!PRICING_ENABLED) redirect("/board");
  return <PricingQueueClient />;
}
