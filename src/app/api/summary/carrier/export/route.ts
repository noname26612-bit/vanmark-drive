import { NextResponse } from "next/server";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { getCarrierSummary } from "@/domain/summary-service";
import { buildCarrierCsv, carrierFileName } from "@/lib/carrier-csv";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/summary/carrier/export — тот же отчёт файлом CSV для Excel. Только диспетчер/админ.
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const sp = new URL(req.url).searchParams;
    const granularity = sp.get("granularity") || "week";
    const date = sp.get("date") || dateKeyInTz(new Date(), KPI_TZ);
    const summary = await getCarrierSummary(granularity, date);
    return new NextResponse(buildCarrierCsv(summary), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${carrierFileName(summary)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
