import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse, readJson, idempotencyKey, occurredAt } from "@/lib/api-route";
import { attachKitPart, listKitCandidates } from "@/domain/machine-service";
import { withIdempotency } from "@/domain/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/machines/:id/kit — что можно добавить в комплект этого станка: свободные комплектующие
// его раздела (ножи вне чужих комплектов, складские позиции с ненулевым остатком).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    return NextResponse.json(ok(await listKitCandidates(id, user)));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/machines/:id/kit { partId, qty } — поставить комплектующую в комплект. Повторный вызов
// с тем же partId меняет количество (складские позиции), а не плодит связи.
// Idempotency-Key: повтор после таймаута на площадке не должен списывать остаток дважды.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    const body = await readJson(req);
    const partId = typeof body.partId === "string" ? body.partId : "";
    const qty = typeof body.qty === "number" && Number.isFinite(body.qty) ? Math.trunc(body.qty) : 1;

    const machine = await withIdempotency(
      idempotencyKey(req),
      user,
      "machine-kit-attach",
      () => attachKitPart(id, { partId, qty }, user),
      occurredAt(req),
    );
    return NextResponse.json(ok(machine), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
