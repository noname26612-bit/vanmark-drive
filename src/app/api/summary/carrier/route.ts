import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { getCarrierSummary } from "@/domain/summary-service";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/summary/carrier?granularity=day|week|month&date=YYYY-MM-DD — затраты на внешнего
// перевозчика за период (этап 3, 02.07). Только диспетчер/админ: деньги компании, водителям нельзя.
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const sp = new URL(req.url).searchParams;
    const granularity = sp.get("granularity") || "week";
    const date = sp.get("date") || dateKeyInTz(new Date(), KPI_TZ);
    return NextResponse.json(ok(await getCarrierSummary(granularity, date)));
  } catch (e) {
    return errorResponse(e);
  }
}
