import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import { listAbsencesInRange, createAbsence } from "@/domain/absence-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/absences?from=YYYY-MM-DD&to=YYYY-MM-DD — отпуска/больничные в период. Только Д/А.
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) throw Errors.validation("Не указан период (from/to)");
    return NextResponse.json(ok(await listAbsencesInRange(from, to)));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/absences {driverId, dateFrom, dateTo, type, note} — завести отсутствие (№9). Только Д/А.
// driverId — за другого (валидируется как DRIVER в сервисе); создавший — из сессии.
export async function POST(req: Request) {
  try {
    const user = await requireDispatcher();
    const body = await readJson(req);
    const driverId = typeof body.driverId === "string" ? body.driverId : "";
    const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : "";
    const dateTo = typeof body.dateTo === "string" ? body.dateTo : "";
    if (!driverId || !dateFrom || !dateTo) throw Errors.validation("Укажите водителя и период отсутствия");
    const type = typeof body.type === "string" ? body.type : undefined;
    const note = typeof body.note === "string" ? body.note : undefined;
    return NextResponse.json(
      ok(await createAbsence({ driverId, dateFrom, dateTo, type, note }, { id: user.id, role: user.role })),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
