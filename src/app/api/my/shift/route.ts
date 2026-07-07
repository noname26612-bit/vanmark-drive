import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDriver, errorResponse, readJson, idempotencyKey, occurredAt } from "@/lib/api-route";
import { getMyShift, openShift, closeShift, reopenShift, hideDispatcherIdle } from "@/domain/shift-service";
import { isExternalDriver } from "@/domain/users";
import { withIdempotency } from "@/domain/idempotency";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/my/shift?date=YYYY-MM-DD — смена водителя на день. Изоляция (CLAUDE.md §1): driverId = user.id
// из сессии, никогда из запроса.
export async function GET(req: Request) {
  try {
    const user = await requireDriver();
    const date = new URL(req.url).searchParams.get("date") ?? "";
    return NextResponse.json(ok(hideDispatcherIdle(await getMyShift(user.id, date))));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/my/shift { op: "open"|"close"|"reopen" } — открыть/закрыть/переоткрыть смену (driverId из
// сессии). reopen — на случай случайного закрытия. День смены берётся на сервере от достоверного
// момента действия (X-Occurred-At через clamp, preflight-аудит В2): клиентскому `today` не доверяем.
// O7: операция работает из офлайн-очереди — Idempotency-Key защищает досылку от двойного эффекта.
// Внешний перевозчик смен не ведёт (02.07) — операции запрещены даже прямым запросом (UI блок смены
// ему не показывает).
export async function POST(req: Request) {
  try {
    const user = await requireDriver();
    if (await isExternalDriver(user.id)) throw Errors.forbidden();
    const body = await readJson(req);
    const op = body.op;
    if (op !== "open" && op !== "close" && op !== "reopen") {
      throw Errors.validation("Неизвестная операция смены");
    }
    const at = occurredAt(req);
    const run =
      op === "open"
        ? () => openShift(user.id, at)
        : op === "close"
          ? () => closeShift(user.id, at)
          : () => reopenShift(user.id, at);
    const result = await withIdempotency(idempotencyKey(req), user, `shift-${op}`, run);
    return NextResponse.json(ok(hideDispatcherIdle(result)));
  } catch (e) {
    return errorResponse(e);
  }
}
