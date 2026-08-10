import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse, readJson, idempotencyKey, occurredAt } from "@/lib/api-route";
import { sendShopTask } from "@/domain/machine-service";
import { withIdempotency } from "@/domain/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/machines/:id/shop-task — зафиксировать «Задание в цех»: полный текст задания пишется
// в журнал (kind=shop_task), по флагу toInRepair той же транзакцией станок переводится «В ремонте».
// Сам текст в Telegram-группу отправляет Максим руками (цех вне системы, PRD §16.6).
// Idempotency-Key: повтор после таймаута не должен плодить дубли задания.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    const body = await readJson(req);
    const note = typeof body.note === "string" ? body.note : null;
    const toInRepair = body.toInRepair === true;

    const machine = await withIdempotency(
      idempotencyKey(req),
      user,
      "machine-shop-task",
      () => sendShopTask(id, { note, toInRepair }, user),
      occurredAt(req),
    );
    return NextResponse.json(ok(machine), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
