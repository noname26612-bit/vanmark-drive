import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { deleteIdleNote } from "@/domain/idle-note-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/idle-notes/:id — удалить пометку (пока из неё не создан штраф). Только диспетчер/админ.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireDispatcher();
    const { id } = await params;
    await deleteIdleNote(id);
    return NextResponse.json(ok({ deleted: true }));
  } catch (e) {
    return errorResponse(e);
  }
}
