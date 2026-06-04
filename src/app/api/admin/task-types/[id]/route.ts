import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { updateTaskType } from "@/domain/task-type-service";
import { parseTaskTypeFields } from "@/lib/task-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/task-types/:id — изменить тип (название, иконка, requiresPhoto, порядок, активность).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const input = parseTaskTypeFields(await readJson(req));
    return NextResponse.json(ok(await updateTaskType(id, input, user)));
  } catch (e) {
    return errorResponse(e);
  }
}
