import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireTaskManager, errorResponse, readJson } from "@/lib/api-route";
import { listTasks, createTask, type ListFilters } from "@/domain/task-service";
import { parseTaskFields, parseStatus, parseTaskKind } from "@/lib/task-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tasks — список для диспетчера (доска и «Все задачи»).
export async function GET(req: Request) {
  try {
    await requireTaskManager();
    const p = new URL(req.url).searchParams;
    const assignee = p.get("assigneeId");
    const filters: ListFilters = {
      date: p.get("date") ?? undefined,
      includeUndated: p.get("includeUndated") === "1",
      dateFrom: p.get("dateFrom") ?? undefined,
      dateTo: p.get("dateTo") ?? undefined,
      undatedOnly: p.get("undatedOnly") === "1",
      assigneeId: assignee === "none" ? "none" : (assignee ?? undefined),
      status: parseStatus(p.get("status")),
      typeId: p.get("typeId") ?? undefined,
      q: p.get("q") ?? undefined,
      // Рабочие экраны (доска, планирование, окно дня календаря) просят убрать отменённые (11.08).
      hideCancelled: p.get("hideCancelled") === "1",
      // Область: активные (по умолчанию) или архив — раздел «Архив» во «Все задачи» (11.08).
      scope: p.get("scope") === "archive" ? "archive" : "active",
      // Контур (15.08). По умолчанию — доставки: так этот список вёл себя всегда, и старый клиент,
      // открытый до деплоя, не увидит на доске задач цеха. Вкладка «Цех» просит STAFF явно.
      kind: parseTaskKind(p.get("kind")) ?? "DELIVERY",
    };
    return NextResponse.json(ok(await listTasks(filters)));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/tasks — создать (номер выдаёт БД).
export async function POST(req: Request) {
  try {
    const user = await requireTaskManager();
    const fields = parseTaskFields(await readJson(req));
    const task = await createTask(fields, user);
    return NextResponse.json(ok(task), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
