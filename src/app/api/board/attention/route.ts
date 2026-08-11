import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireTaskManager, errorResponse } from "@/lib/api-route";
import { listAttention } from "@/domain/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/board/attention?date=YYYY-MM-DD — блок «Требуют внимания» доски (Этап 6).
// Кто ведёт заявки (requireTaskManager: Д/А + менеджер-сервисник с 11.08.2026); водителю — 403.
export async function GET(req: Request) {
  try {
    await requireTaskManager();
    const date = new URL(req.url).searchParams.get("date") ?? "";
    return NextResponse.json(ok(await listAttention(date)));
  } catch (e) {
    return errorResponse(e);
  }
}
