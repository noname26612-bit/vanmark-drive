import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, readJson, idempotencyKey } from "@/lib/api-route";
import { addWorkItem } from "@/domain/work-service";
import { withIdempotency } from "@/domain/idempotency";
import { parseWorkItemInput } from "@/lib/work-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/work-items — добавить позицию ведомости. Изоляция/правила — в домене
// (чужая задача → 404, тип без расценки/отправленная ведомость → ошибка).
// Офлайн-режим: Idempotency-Key против дубля позиции при досылке.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const input = parseWorkItemInput(await readJson(req));
    const item = await withIdempotency(idempotencyKey(req), user, "work-item-add", () =>
      addWorkItem(id, input, user),
    );
    return NextResponse.json(ok(item), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
