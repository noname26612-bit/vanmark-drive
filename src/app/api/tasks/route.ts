import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import { listTasks, createTask, type ListFilters } from "@/domain/task-service";
import { parseTaskFields, parseStatus } from "@/lib/task-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tasks — список для диспетчера (доска и «Все задачи»).
export async function GET(req: Request) {
  try {
    await requireDispatcher();
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
    };
    return NextResponse.json(ok(await listTasks(filters)));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/tasks — создать (номер выдаёт БД).
export async function POST(req: Request) {
  try {
    const user = await requireDispatcher();
    const fields = parseTaskFields(await readJson(req));
    const task = await createTask(fields, user);
    return NextResponse.json(ok(task), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
