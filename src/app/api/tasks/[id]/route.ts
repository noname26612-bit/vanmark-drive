import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import {
  getTaskById,
  updateTaskFields,
  assignTask,
  rescheduleTask,
} from "@/domain/task-service";
import { parseTaskFields } from "@/lib/task-input";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/tasks/:id — карточка с историей. Изоляция: водителю чужая → 404 (в домене).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    return NextResponse.json(ok(await getTaskById(id, user)));
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/tasks/:id — редактирование полей / назначение / перенос (диспетчер).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireDispatcher();
    const { id } = await params;
    const body = await readJson(req);
    const op = typeof body.op === "string" ? body.op : "edit";

    if (op === "assign") {
      const a = body.assigneeId;
      const assigneeId = a === null ? null : typeof a === "string" ? a : undefined;
      if (assigneeId === undefined) throw Errors.validation("Не указан исполнитель");
      return NextResponse.json(ok(await assignTask(id, assigneeId, user)));
    }
    if (op === "reschedule") {
      const date = typeof body.scheduledDate === "string" ? body.scheduledDate : "";
      const comment = typeof body.comment === "string" ? body.comment : undefined;
      return NextResponse.json(ok(await rescheduleTask(id, date, user, comment)));
    }
    const fields = parseTaskFields(body);
    return NextResponse.json(ok(await updateTaskFields(id, fields, user)));
  } catch (e) {
    return errorResponse(e);
  }
}
