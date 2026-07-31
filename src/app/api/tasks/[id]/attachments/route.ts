import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, idempotencyKey, occurredAt } from "@/lib/api-route";
import { addAttachment } from "@/domain/attachment-service";
import { withIdempotency } from "@/domain/idempotency";
import { MAX_UPLOAD_BYTES } from "@/domain/attachments";
import { Errors } from "@/domain/errors";

// Запас на multipart-обвязку поверх лимита самого файла (15 МБ): границы, заголовки полей, lat/lng.
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

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

    // Ранний отбой по заявленному размеру тела ДО буферизации (preflight-аудит В1): не читаем
    // multipart в память, если Content-Length заведомо превышает лимит. Это второй слой к Caddy
    // request_body (Content-Length можно подделать/опустить — основной предел держит прокси).
    const declaredLength = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      throw Errors.uploadInvalid("Файл больше 15 МБ");
    }

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
      occurredAt(req),
    );
    return NextResponse.json(ok(att), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
