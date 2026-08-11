import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, requireTaskManager, errorResponse, readJson } from "@/lib/api-route";
import {
  getTaskById,
  updateTaskFields,
  assignTask,
  rescheduleTask,
  planTask,
  archiveTask,
  unarchiveTask,
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

// PATCH /api/tasks/:id — редактирование полей / назначение / перенос / архив.
// Кто ведёт заявки: диспетчер, админ и менеджер-сервисник (11.08.2026).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireTaskManager();
    const { id } = await params;
    const body = await readJson(req);
    const op = typeof body.op === "string" ? body.op : "edit";

    if (op === "assign") {
      const a = body.assigneeId;
      const assigneeId = a === null ? null : typeof a === "string" ? a : undefined;
      if (assigneeId === undefined) throw Errors.validation("Не указан исполнитель");
      // `today` — дата клиента для авто-простановки при назначении задачи без даты (п.1).
      const today = typeof body.today === "string" ? body.today : undefined;
      return NextResponse.json(ok(await assignTask(id, assigneeId, user, { today })));
    }
    if (op === "reschedule") {
      const date = typeof body.scheduledDate === "string" ? body.scheduledDate : "";
      const comment = typeof body.comment === "string" ? body.comment : undefined;
      return NextResponse.json(ok(await rescheduleTask(id, date, user, comment)));
    }
    if (op === "plan") {
      // Перетаскивание в ячейку сетки «Планирование»: дата (столбец) + водитель (строка).
      const scheduledDate =
        body.scheduledDate === null || typeof body.scheduledDate === "string"
          ? (body.scheduledDate as string | null)
          : null;
      const assigneeId =
        body.assigneeId === null || typeof body.assigneeId === "string"
          ? (body.assigneeId as string | null)
          : null;
      return NextResponse.json(ok(await planTask(id, { scheduledDate, assigneeId }, user)));
    }
    if (op === "archive") {
      // Архив (11.08.2026): убрать дубль/ошибочную заявку из работы. Причина по желанию — пишется в журнал.
      const reason = typeof body.reason === "string" ? body.reason : null;
      return NextResponse.json(ok(await archiveTask(id, user, reason)));
    }
    if (op === "unarchive") {
      return NextResponse.json(ok(await unarchiveTask(id, user)));
    }
    const fields = parseTaskFields(body);
    return NextResponse.json(ok(await updateTaskFields(id, fields, user)));
  } catch (e) {
    return errorResponse(e);
  }
}
