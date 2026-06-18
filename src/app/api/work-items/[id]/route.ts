import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, readJson } from "@/lib/api-route";
import { updateWorkItem, removeWorkItem } from "@/domain/work-service";
import { parseWorkItemInput } from "@/lib/work-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/work-items/:id — изменить позицию (кол-во, название свободной строки). Правила — в домене.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const input = parseWorkItemInput(await readJson(req));
    return NextResponse.json(ok(await updateWorkItem(id, input, user)));
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/work-items/:id — удалить позицию (пока ведомость в DRAFT). Изоляция — в домене.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await removeWorkItem(id, user);
    return NextResponse.json(ok({ ok: true }));
  } catch (e) {
    return errorResponse(e);
  }
}
