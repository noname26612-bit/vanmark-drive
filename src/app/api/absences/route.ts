import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, requireTaskManager, errorResponse, readJson } from "@/lib/api-route";
import { listAbsencesInRange, createAbsence } from "@/domain/absence-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/absences?from=YYYY-MM-DD&to=YYYY-MM-DD — отпуска/больничные в период. Просмотр — всем,
// кто ведёт заявки (без этого не спланируешь неделю); заводит и удаляет отсутствия только Д/А.
export async function GET(req: Request) {
  try {
    await requireTaskManager();
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
// driverId — за другого; с 18.08.2026 это любой действующий сотрудник компании, не только водитель
// (вкладка «Команда», PRD §18) — валидация в сервисе. Создавший — из сессии.
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
