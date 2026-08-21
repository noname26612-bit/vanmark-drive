import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireTeamManager, errorResponse } from "@/lib/api-route";
import { deleteAbsence } from "@/domain/absence-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/absences/:id — убрать отсутствие сотрудника (№9). Диспетчер, админ, менеджер-сервисник.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireTeamManager();
    const { id } = await params;
    await deleteAbsence(id, { id: user.id, role: user.role });
    return NextResponse.json(ok({ id }));
  } catch (e) {
    return errorResponse(e);
  }
}
