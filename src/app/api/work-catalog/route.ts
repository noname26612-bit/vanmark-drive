import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse } from "@/lib/api-route";
import { listWorkCatalog } from "@/domain/work-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/work-catalog — активные работы для выбора в ведомости (водитель/диспетчер).
export async function GET() {
  try {
    await requireApiUser();
    return NextResponse.json(ok(await listWorkCatalog()));
  } catch (e) {
    return errorResponse(e);
  }
}
