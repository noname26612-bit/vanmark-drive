import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDriver, errorResponse } from "@/lib/api-route";
import { listMyTasks } from "@/domain/task-service";
import type { MyTasksScope } from "@/domain/my-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/my/tasks?date=YYYY-MM-DD&scope=today|upcoming
// ТОЛЬКО задачи водителя из сессии: личность берётся из requireDriver(), не из запроса.
// Изоляция гарантируется доменом (listMyTasks → myTasksWhere прибивает assigneeId к user.id).
export async function GET(req: Request) {
  try {
    const user = await requireDriver();
    const p = new URL(req.url).searchParams;
    const date = p.get("date") ?? "";
    const scope: MyTasksScope = p.get("scope") === "upcoming" ? "upcoming" : "today";
    const tasks = await listMyTasks(user, { today: date, scope });
    return NextResponse.json(ok(tasks));
  } catch (e) {
    return errorResponse(e);
  }
}
