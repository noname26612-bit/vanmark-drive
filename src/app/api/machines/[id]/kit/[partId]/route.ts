import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse } from "@/lib/api-route";
import { detachKitPart } from "@/domain/machine-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; partId: string }> };

// DELETE /api/machines/:id/kit/:partId — разобрать комплект. Уже уехавшую (списанную) связь домен
// не отдаёт разбирать: она часть истории проданного комплекта.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id, partId } = await params;
    return NextResponse.json(ok(await detachKitPart(id, partId, user)));
  } catch (e) {
    return errorResponse(e);
  }
}
