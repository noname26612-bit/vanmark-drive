import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, readJson } from "@/lib/api-route";
import { addWorkItem } from "@/domain/work-service";
import { parseWorkItemInput } from "@/lib/work-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/work-items — добавить позицию ведомости. Изоляция/правила — в домене
// (чужая задача → 404, тип без расценки/отправленная ведомость → ошибка).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const input = parseWorkItemInput(await readJson(req));
    return NextResponse.json(ok(await addWorkItem(id, input, user)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
