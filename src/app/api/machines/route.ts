import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse, readJson, idempotencyKey, occurredAt } from "@/lib/api-route";
import { createMachine, listMachines } from "@/domain/machine-service";
import { withIdempotency } from "@/domain/idempotency";
import {
  parseCategory,
  parseEquipmentKind,
  parseFlag,
  parseInt0,
  parseMachineFields,
  parseMachineStatus,
} from "@/lib/machine-input";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/machines?scope=active|archive&category&status&kind&flag&q&take&skip — картотека +
// счётчики сводки. Доступ: менеджер-сервисник / диспетчер / админ (водителю — 404, см. requireMachineUser).
export async function GET(req: Request) {
  try {
    const user = await requireMachineUser();
    const url = new URL(req.url);
    const result = await listMachines(
      {
        scope: url.searchParams.get("scope") === "archive" ? "archive" : "active",
        category: parseCategory(url.searchParams.get("category")),
        status: parseMachineStatus(url.searchParams.get("status")),
        kind: parseEquipmentKind(url.searchParams.get("kind")),
        flag: parseFlag(url.searchParams.get("flag")),
        q: url.searchParams.get("q") ?? undefined,
        take: parseInt0(url.searchParams.get("take")),
        skip: parseInt0(url.searchParams.get("skip")),
      },
      user,
    );
    return NextResponse.json(ok(result));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/machines — завести станок. Обязательны только категория и модель (PRD §16.4).
// Idempotency-Key защищает от двойного нажатия и от повтора при плохой связи на площадке:
// иначе один станок заводился бы дважды.
export async function POST(req: Request) {
  try {
    const user = await requireMachineUser();
    const body = await readJson(req);
    const category = parseCategory(body.category);
    if (!category) throw Errors.validation("Выберите категорию станка");

    const machine = await withIdempotency(
      idempotencyKey(req),
      user,
      "machine-create",
      () => createMachine({ ...parseMachineFields(body), category }, user),
      occurredAt(req),
    );
    return NextResponse.json(ok(machine), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
