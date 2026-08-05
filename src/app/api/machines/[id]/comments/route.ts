import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse, readJson, idempotencyKey, occurredAt } from "@/lib/api-route";
import { addComment } from "@/domain/machine-service";
import { withIdempotency } from "@/domain/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/machines/:id/comments — запись в журнал станка. Журнал только на запись:
// комментарии не редактируются и не удаляются (CLAUDE.md правило 3).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    const body = await readJson(req);
    const text = typeof body.comment === "string" ? body.comment : "";

    const machine = await withIdempotency(
      idempotencyKey(req),
      user,
      "machine-comment",
      () => addComment(id, text, user),
      occurredAt(req),
    );
    return NextResponse.json(ok(machine), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
