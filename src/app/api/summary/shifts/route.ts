import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { getShiftHistory } from "@/domain/summary-service";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/summary/shifts?granularity=&date=&driverId= — история смен за окно периода (№3, 03.07):
// журнал смен с временами открытия/закрытия для показа и правки в «Сводке». Только диспетчер/админ.
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const sp = new URL(req.url).searchParams;
    const granularity = sp.get("granularity") || "week";
    const date = sp.get("date") || dateKeyInTz(new Date(), KPI_TZ);
    const driverId = sp.get("driverId") || undefined;
    return NextResponse.json(ok(await getShiftHistory(granularity, date, driverId)));
  } catch (e) {
    return errorResponse(e);
  }
}
