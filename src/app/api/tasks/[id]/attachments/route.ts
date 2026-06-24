import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, idempotencyKey } from "@/lib/api-route";
import { addAttachment } from "@/domain/attachment-service";
import { withIdempotency } from "@/domain/idempotency";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/attachments (multipart) — фото к задаче. Д или В(своя): личность из сессии,
// изоляция и валидация (mime/размер) — в домене. Имя файла генерит сервер (см. lib/uploads).
// Офлайн-режим: Idempotency-Key защищает от повторной загрузки того же фото при досылке.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw Errors.uploadInvalid("Файл не передан");

    const bytes = Buffer.from(await file.arrayBuffer());
    const num = (v: FormDataEntryValue | null): number | null => {
      if (typeof v !== "string" || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const kind = form.get("kind") === "DOCUMENT" ? "DOCUMENT" : "PHOTO";

    const att = await withIdempotency(idempotencyKey(req), user, "attachment", () =>
      addAttachment(id, user, {
        bytes,
        mimeType: file.type,
        sizeBytes: bytes.byteLength,
        kind,
        lat: num(form.get("lat")),
        lng: num(form.get("lng")),
      }),
    );
    return NextResponse.json(ok(att), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
