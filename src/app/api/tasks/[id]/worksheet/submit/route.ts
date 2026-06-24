import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, idempotencyKey } from "@/lib/api-route";
import { submitWorksheet } from "@/domain/work-service";
import { withIdempotency } from "@/domain/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/worksheet/submit — отправить ведомость на расценку (DRAFT→PRICING).
// Изоляция и проверки (тип с расценкой, непустая ведомость) — в домене.
// Офлайн-режим: Idempotency-Key — повтор досылки не отправит ведомость дважды.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const result = await withIdempotency(idempotencyKey(req), user, "worksheet-submit", () =>
      submitWorksheet(id, user),
    );
    return NextResponse.json(ok(result));
  } catch (e) {
    return errorResponse(e);
  }
}
