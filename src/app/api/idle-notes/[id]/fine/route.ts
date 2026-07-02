import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import { fineFromIdleNote } from "@/domain/idle-note-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/idle-notes/:id/fine { amount } — создать из пометки ручной штраф KPI (MANUAL).
// Сумму вводит Милена; водитель увидит штраф в «Мой расчёт», но не саму пометку. Только диспетчер/админ.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireDispatcher();
    const { id } = await params;
    const body = await readJson(req);
    const amount = typeof body.amount === "number" ? Math.trunc(body.amount) : NaN;
    if (!Number.isFinite(amount)) throw Errors.validation("Не указана сумма штрафа");
    return NextResponse.json(ok(await fineFromIdleNote(id, { amount }, user)));
  } catch (e) {
    return errorResponse(e);
  }
}
