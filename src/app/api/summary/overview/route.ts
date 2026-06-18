import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { getDriverSummary } from "@/domain/summary-service";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/summary/overview?granularity=day|week|month&date=YYYY-MM-DD — управленческая сводка по
// водителям за период (по дате закрытия задач). Только диспетчер/админ (ARCHITECTURE §6–7).
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const sp = new URL(req.url).searchParams;
    const granularity = sp.get("granularity") || "week";
    const date = sp.get("date") || dateKeyInTz(new Date(), KPI_TZ);
    return NextResponse.json(ok(await getDriverSummary(granularity, date)));
  } catch (e) {
    return errorResponse(e);
  }
}
