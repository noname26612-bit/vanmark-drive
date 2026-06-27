import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import { adjustShiftOpenedAt, reopenShiftById } from "@/domain/shift-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/shifts/:id — правка смены диспетчером/админом:
//  • {op:"reopen"} — переоткрыть закрытую смену (случайно закрыл);
//  • {openedAtTime:"ЧЧ:ММ", reason} — правка времени открытия задним числом (№3): время любое,
//    причина обязательна, в закрытом месяце — отказ.
// Только диспетчер/админ. Личность правящего — из сессии; SHIFT_LATE пересчитывается в сервисе.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireDispatcher();
    const { id } = await params;
    const body = await readJson(req);
    if (body.op === "reopen") {
      return NextResponse.json(ok(await reopenShiftById(id)));
    }
    const timeHHMM = typeof body.openedAtTime === "string" ? body.openedAtTime : "";
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!timeHHMM.trim()) throw Errors.validation("Укажите время открытия (ЧЧ:ММ)");
    return NextResponse.json(
      ok(await adjustShiftOpenedAt(id, { timeHHMM, reason }, { id: user.id, role: user.role })),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
