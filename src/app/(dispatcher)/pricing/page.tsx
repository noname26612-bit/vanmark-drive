import { redirect } from "next/navigation";
import { PRICING_ENABLED } from "@/lib/features";
import { PricingQueueClient } from "./pricing-queue-client";

export const dynamic = "force-dynamic";

export default function PricingPage() {
  // Раздел «Расценка» скрыт под флагом (06.07). Прямой заход по URL уводим на доску.
  if (!PRICING_ENABLED) redirect("/board");
  return <PricingQueueClient />;
}
