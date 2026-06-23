import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { deleteAbsence } from "@/domain/absence-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/absences/:id — убрать отсутствие водителя (№9). Только диспетчер/админ.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireDispatcher();
    const { id } = await params;
    await deleteAbsence(id);
    return NextResponse.json(ok({ id }));
  } catch (e) {
    return errorResponse(e);
  }
}
