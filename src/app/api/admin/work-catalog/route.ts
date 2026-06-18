import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { listAllWorkCatalog, createWorkCatalogItem } from "@/domain/work-service";
import { parseWorkCatalogInput } from "@/lib/work-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/work-catalog — все работы (включая скрытые). POST — создать. Только админ.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(ok(await listAllWorkCatalog()));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const input = parseWorkCatalogInput(await readJson(req));
    return NextResponse.json(ok(await createWorkCatalogItem(input, user)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
