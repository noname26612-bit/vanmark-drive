import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, readJson, idempotencyKey, occurredAt } from "@/lib/api-route";
import { transitionTask } from "@/domain/task-service";
import { withIdempotency } from "@/domain/idempotency";
import { parseStatus } from "@/lib/task-input";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/transition — смена статуса по матрице (водитель/диспетчер).
// Офлайн-режим: Idempotency-Key защищает от повторной досылки, X-Occurred-At несёт момент действия.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const body = await readJson(req);
    const toStatus = parseStatus(body.toStatus);
    if (!toStatus) throw Errors.validation("Неизвестный статус");
    const comment = typeof body.comment === "string" ? body.comment : undefined;
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const lat = typeof body.lat === "number" ? body.lat : undefined;
    const lng = typeof body.lng === "number" ? body.lng : undefined;
    // DONE при оплате «на месте»: подтверждение получения денег (PRD §5) либо причина неоплаты (№8).
    const paymentConfirmed = body.paymentConfirmed === true;
    const paymentAmount = typeof body.paymentAmount === "number" ? body.paymentAmount : undefined;
    const paymentMissedReason =
      typeof body.paymentMissedReason === "string" ? body.paymentMissedReason : undefined;
    const task = await withIdempotency(idempotencyKey(req), user, "transition", () =>
      transitionTask(id, toStatus, user, {
        comment,
        reason,
        lat,
        lng,
        paymentConfirmed,
        paymentAmount,
        paymentMissedReason,
        occurredAt: occurredAt(req),
      }),
    );
    return NextResponse.json(ok(task));
  } catch (e) {
    return errorResponse(e);
  }
}
