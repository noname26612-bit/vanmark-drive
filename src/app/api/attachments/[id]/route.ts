import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse } from "@/lib/api-route";
import { getAttachmentForDownload, deleteAttachment } from "@/domain/attachment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/attachments/:id — отдать файл С проверкой прав (НЕ из public/). Чужая задача → 404.
// nosniff + inline: браузер не угадывает тип, отдаём ровно сохранённый mime.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const { bytes, mimeType } = await getAttachmentForDownload(id, user);
    const body = new Uint8Array(bytes); // Buffer → Uint8Array<ArrayBuffer> для BodyInit
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/attachments/:id — удалить вложение до завершения (свой автор или диспетчер).
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await deleteAttachment(id, user);
    return NextResponse.json(ok({ ok: true }));
  } catch (e) {
    return errorResponse(e);
  }
}
