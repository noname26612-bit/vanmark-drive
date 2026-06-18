import { NextResponse } from "next/server";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { getDriverSummary } from "@/domain/summary-service";
import { buildSummaryCsv, summaryFileName } from "@/lib/summary-csv";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/summary/export?granularity=day|week|month&date=YYYY-MM-DD — та же сводка файлом CSV
// для Excel. Только диспетчер/админ (тот же гейт, что и overview — данные по всем водителям).
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const sp = new URL(req.url).searchParams;
    const granularity = sp.get("granularity") || "week";
    const date = sp.get("date") || dateKeyInTz(new Date(), KPI_TZ);
    const overview = await getDriverSummary(granularity, date);
    return new NextResponse(buildSummaryCsv(overview), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${summaryFileName(overview)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
