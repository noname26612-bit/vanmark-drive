import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import {
  adjustShiftOpenedAt,
  adjustShiftClosedAt,
  closeShiftById,
  reopenShiftById,
} from "@/domain/shift-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/shifts/:id — действия над сменой водителя (диспетчер/директор/админ). Работаем по shiftId,
// личность водителя берётся из самой смены (изоляция цела):
//  • {op:"reopen"} — переоткрыть закрытую смену (случайно закрыл);
//  • {op:"close", closedAtTime?, reason?} — закрыть смену за водителя (№2): по умолчанию «сейчас»,
//    можно задать время (ЧЧ:ММ) и причину;
//  • {closedAtTime:"ЧЧ:ММ", reason} — правка времени закрытия задним числом (№3): причина обязательна;
//  • {openedAtTime:"ЧЧ:ММ", reason} — правка времени открытия задним числом (№3).
// Только Д/А (requireDispatcher). Личность действующего — из сессии; правки в закрытом месяце — отказ.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireDispatcher();
    const { id } = await params;
    const body = await readJson(req);
    const actor = { id: user.id, role: user.role };
    const reason = typeof body.reason === "string" ? body.reason : "";

    if (body.op === "reopen") {
      return NextResponse.json(ok(await reopenShiftById(id)));
    }
    if (body.op === "close") {
      const closedAtTime = typeof body.closedAtTime === "string" ? body.closedAtTime : undefined;
      return NextResponse.json(ok(await closeShiftById(id, actor, { closedAtTime, reason })));
    }

    const closedAtTime = typeof body.closedAtTime === "string" ? body.closedAtTime : "";
    if (closedAtTime.trim()) {
      return NextResponse.json(ok(await adjustShiftClosedAt(id, { timeHHMM: closedAtTime, reason }, actor)));
    }
    const openedAtTime = typeof body.openedAtTime === "string" ? body.openedAtTime : "";
    if (!openedAtTime.trim()) throw Errors.validation("Укажите время открытия или закрытия (ЧЧ:ММ)");
    return NextResponse.json(ok(await adjustShiftOpenedAt(id, { timeHHMM: openedAtTime, reason }, actor)));
  } catch (e) {
    return errorResponse(e);
  }
}
