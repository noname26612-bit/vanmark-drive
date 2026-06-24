import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, readJson, idempotencyKey } from "@/lib/api-route";
import { updateWorkItem, removeWorkItem } from "@/domain/work-service";
import { withIdempotency } from "@/domain/idempotency";
import { parseWorkItemInput } from "@/lib/work-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/work-items/:id — изменить позицию (кол-во, название свободной строки). Правила — в домене.
// Офлайн-режим: Idempotency-Key — повтор досылки не навредит (значение абсолютное).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const input = parseWorkItemInput(await readJson(req));
    const item = await withIdempotency(idempotencyKey(req), user, "work-item-update", () =>
      updateWorkItem(id, input, user),
    );
    return NextResponse.json(ok(item));
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/work-items/:id — удалить позицию (пока ведомость в DRAFT). Изоляция — в домене.
// Офлайн-режим: Idempotency-Key — повтор удаления уже удалённой вернёт прежний ответ, не 404.
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await withIdempotency(idempotencyKey(req), user, "work-item-delete", async () => {
      await removeWorkItem(id, user);
      return { ok: true };
    });
    return NextResponse.json(ok({ ok: true }));
  } catch (e) {
    return errorResponse(e);
  }
}
