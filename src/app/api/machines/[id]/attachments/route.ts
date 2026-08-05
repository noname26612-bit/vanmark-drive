import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse, idempotencyKey, occurredAt } from "@/lib/api-route";
import { addMachinePhoto } from "@/domain/machine-attachment-service";
import { withIdempotency } from "@/domain/idempotency";
import { MAX_UPLOAD_BYTES } from "@/domain/attachments";
import { Errors } from "@/domain/errors";

// Запас на multipart-обвязку поверх лимита самого файла (15 МБ): границы и заголовки полей.
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/machines/:id/attachments (multipart) — фото станка. Карточка уже создана: фото
// догружаются следом и с автоповтором, поэтому обрыв связи на площадке не теряет ввод.
// Idempotency-Key обязателен для ретрая — иначе повтор задвоил бы снимок.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;

    // Ранний отбой по заявленному размеру ДО буферизации тела (как у вложений задач): второй слой
    // к лимиту Caddy — Content-Length можно опустить, основной предел держит прокси.
    const declaredLength = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      throw Errors.uploadInvalid("Файл больше 15 МБ");
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw Errors.uploadInvalid("Файл не передан");
    const bytes = Buffer.from(await file.arrayBuffer());

    const att = await withIdempotency(
      idempotencyKey(req),
      user,
      "machine-photo",
      () =>
        addMachinePhoto(id, user, {
          bytes,
          mimeType: file.type,
          sizeBytes: bytes.byteLength,
        }),
      occurredAt(req),
    );
    return NextResponse.json(ok(att), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
