import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse } from "@/lib/api-route";
import { getMachinePhotoForDownload, deleteMachinePhoto } from "@/domain/machine-attachment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/machines/photos/:id — отдать файл С проверкой прав (НЕ из public/, ARCHITECTURE §6).
// nosniff + inline: браузер не угадывает тип, отдаём ровно сохранённый mime.
// Путь намеренно НЕ /api/machines/attachments/:id — иначе он пересекался бы с /api/machines/:id/...
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    const { bytes, mimeType } = await getMachinePhotoForDownload(id, user);
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

// DELETE /api/machines/photos/:id — убрать фото (автор либо диспетчер/админ). Событие пишется
// в журнал: картотека помнит, что снимок был и кто его убрал.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    await deleteMachinePhoto(id, user);
    return NextResponse.json(ok({ ok: true }));
  } catch (e) {
    return errorResponse(e);
  }
}
