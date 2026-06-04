import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, readJson } from "@/lib/api-route";
import { addComment } from "@/domain/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/comments — комментарий (диспетчер или назначенный водитель).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const body = await readJson(req);
    const text = typeof body.text === "string" ? body.text : "";
    const lat = typeof body.lat === "number" ? body.lat : undefined;
    const lng = typeof body.lng === "number" ? body.lng : undefined;
    await addComment(id, text, user, { lat, lng });
    return NextResponse.json(ok({ ok: true }), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
