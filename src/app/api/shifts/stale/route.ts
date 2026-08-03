import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { listStaleShifts } from "@/domain/shift-service";
import { dateKeyInTz, KPI_TZ } from "@/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shifts/stale?before=YYYY-MM-DD — незакрытые смены за прошедшие дни (03.08).
// Водитель забыл закрыть смену, день прошёл: смена выпадает из Сводки и зарплаты, а на доске
// её не видно (доска грузит только сегодняшний день). Отдаём диспетчеру/директору/админу, чтобы
// он закрыл её вручную. Только Д/А (requireDispatcher); driverId — из самой смены, не из запроса.
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const before = new URL(req.url).searchParams.get("before") ?? dateKeyInTz(new Date(), KPI_TZ);
    return NextResponse.json(ok(await listStaleShifts(before)));
  } catch (e) {
    return errorResponse(e);
  }
}
