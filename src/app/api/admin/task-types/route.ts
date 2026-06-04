import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { listAllTaskTypes, createTaskType } from "@/domain/task-type-service";
import { parseTaskTypeFields } from "@/lib/task-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/task-types — все типы (включая скрытые). POST — создать. Только админ.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(ok(await listAllTaskTypes()));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const input = parseTaskTypeFields(await readJson(req));
    return NextResponse.json(ok(await createTaskType(input, user)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
