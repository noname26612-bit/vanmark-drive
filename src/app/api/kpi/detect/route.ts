import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import { detectCandidatesForDate } from "@/domain/kpi-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/kpi/detect {date?: YYYY-MM-DD, asOf?: ISO} — ручной прогон детектора кандидатов (та же
// логика, что в ночном cron). Без параметров — за сегодня; date — полдень UTC этого дня; asOf — точный
// момент (нужен проверкам дедлайна актов 20:00, в т.ч. e2e). Только диспетчер. Идемпотентно.
export async function POST(req: Request) {
  try {
    await requireDispatcher();
    const body = await readJson(req);
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
    const asOfRaw = typeof body.asOf === "string" ? new Date(body.asOf) : null;
    const asOf =
      asOfRaw && !Number.isNaN(asOfRaw.getTime())
        ? asOfRaw
        : date
          ? new Date(`${date}T12:00:00.000Z`)
          : new Date();
    return NextResponse.json(ok(await detectCandidatesForDate(asOf)));
  } catch (e) {
    return errorResponse(e);
  }
}
