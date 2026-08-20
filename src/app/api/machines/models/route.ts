import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse, readJson } from "@/lib/api-route";
import { suppressModel, unsuppressModel } from "@/domain/machine-service";
import { parseFamily } from "@/lib/machine-input";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Подсказки моделей в комбобоксе: скрыть (POST) и вернуть (DELETE).
 *
 * Пул подсказок складывается из справочника-константы и реально введённых названий, поэтому
 * временное имя вроде «Хз ждём Михаила» потом предлагается всем и навсегда (жалоба Артёма
 * 20.08.2026). Крестик в списке скрывает подсказку; сами карточки не меняются.
 *
 * Idempotency-Key не нужен: обе операции идемпотентны по природе (upsert и deleteMany), повтор при
 * плохой связи ничего не ломает. Доступ — общий guard модуля (роль из белого списка либо
 * персональный флаг): картотека общая, изоляции «по владельцу» у неё нет by design.
 */
async function nameFrom(req: Request): Promise<{ family: ReturnType<typeof parseFamily>; name: string }> {
  const body = await readJson(req);
  const name = typeof body.name === "string" ? body.name : "";
  if (!name.trim()) throw Errors.validation("Укажите модель");
  return { family: parseFamily(body.family), name };
}

export async function POST(req: Request) {
  try {
    const user = await requireMachineUser();
    const { family, name } = await nameFrom(req);
    await suppressModel(user, family ?? "BENDER", name);
    return NextResponse.json(ok({ suppressed: true }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireMachineUser();
    const { family, name } = await nameFrom(req);
    await unsuppressModel(user, family ?? "BENDER", name);
    return NextResponse.json(ok({ suppressed: false }));
  } catch (e) {
    return errorResponse(e);
  }
}
