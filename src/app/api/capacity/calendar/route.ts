import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { buildWorkloadCalendar } from "@/domain/capacity-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/capacity/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — загрузка водителей по дням (Фаза 2,
// PRD §14.4). Только диспетчер/админ (как «Сводка»). Период задаёт клиент (локальные даты).
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) throw Errors.validation("Не указан период (from/to)");
    return NextResponse.json(ok(await buildWorkloadCalendar(from, to)));
  } catch (e) {
    return errorResponse(e);
  }
}
