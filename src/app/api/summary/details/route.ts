import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { getSummaryDetails } from "@/domain/summary-service";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/summary/details?metric=&granularity=&date=&driverId= — drill-down Сводки (v2, 02.07):
// список задач/смен/пометок за цифрой. Те же окна и фильтры, что у агрегатов. Только диспетчер/админ.
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const sp = new URL(req.url).searchParams;
    const metric = sp.get("metric") ?? "";
    const granularity = sp.get("granularity") || "week";
    const date = sp.get("date") || dateKeyInTz(new Date(), KPI_TZ);
    const driverId = sp.get("driverId") || undefined;
    return NextResponse.json(ok(await getSummaryDetails(metric, granularity, date, driverId)));
  } catch (e) {
    return errorResponse(e);
  }
}
