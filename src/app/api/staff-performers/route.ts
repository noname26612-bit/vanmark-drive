import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireTaskManager, errorResponse } from "@/lib/api-route";
import { listStaffPerformers } from "@/domain/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/staff-performers — кому можно ставить задачи сотрудникам (цех, снабжение).
// Только тем, кто эти задачи ставит: водителю список коллег с их доступами знать незачем.
export async function GET() {
  try {
    await requireTaskManager();
    return NextResponse.json(ok(await listStaffPerformers()));
  } catch (e) {
    return errorResponse(e);
  }
}
