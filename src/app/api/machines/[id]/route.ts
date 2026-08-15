import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse, readJson } from "@/lib/api-route";
import {
  changeCategory,
  changeStatus,
  editMachine,
  getMachine,
  markChecked,
} from "@/domain/machine-service";
import { parseCategory, parseMachineFields, parseMachineStatus } from "@/lib/machine-input";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/machines/:id — карточка станка: поля, фото, журнал «было→стало».
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    return NextResponse.json(ok(await getMachine(id, user)));
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/machines/:id — операции над карточкой (op-style, как у задач и смен):
//   edit      — правка полей (журнал пишет «было→стало»);
//   status    — смена состояния (валидация совместимости с категорией; VOIDED требует причину);
//   category  — смена категории (текущее состояние должно остаться совместимым);
//   diagnosed — отметка «Диагностика проведена»;
//   verified  — отметка «Подтверждён на месте» (сверка при обходе площадки).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireMachineUser();
    const { id } = await params;
    const body = await readJson(req);
    const op = typeof body.op === "string" ? body.op : "edit";

    switch (op) {
      case "edit":
        return NextResponse.json(ok(await editMachine(id, parseMachineFields(body), user)));
      case "status": {
        const status = parseMachineStatus(body.status);
        if (!status) throw Errors.validation("Неизвестное состояние");
        const reason = typeof body.reason === "string" ? body.reason : null;
        // withKit приходит только по явной галочке в переспросе: комплект едет вместе с головным
        // (15.08.2026), но никогда молча — молчаливая правка чужих карточек незаметна.
        const withKit = body.withKit === true;
        return NextResponse.json(ok(await changeStatus(id, { status, reason, withKit }, user)));
      }
      case "category": {
        const category = parseCategory(body.category);
        if (!category) throw Errors.validation("Неизвестная категория");
        return NextResponse.json(ok(await changeCategory(id, { category }, user)));
      }
      case "diagnosed":
        return NextResponse.json(ok(await markChecked(id, "diagnosed", user)));
      case "verified":
        return NextResponse.json(ok(await markChecked(id, "verified", user)));
      default:
        throw Errors.validation("Неизвестная операция");
    }
  } catch (e) {
    return errorResponse(e);
  }
}
