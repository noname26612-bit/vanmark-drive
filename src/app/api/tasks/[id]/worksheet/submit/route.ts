import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse } from "@/lib/api-route";
import { submitWorksheet } from "@/domain/work-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/worksheet/submit — отправить ведомость на расценку (DRAFT→PRICING).
// Изоляция и проверки (тип с расценкой, непустая ведомость) — в домене.
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    return NextResponse.json(ok(await submitWorksheet(id, user)));
  } catch (e) {
    return errorResponse(e);
  }
}
