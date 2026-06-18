import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { updateWorkCatalogItem } from "@/domain/work-service";
import { parseWorkCatalogInput } from "@/lib/work-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/work-catalog/:id — изменить работу (название, активность, порядок). Только админ.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const input = parseWorkCatalogInput(await readJson(req));
    return NextResponse.json(ok(await updateWorkCatalogItem(id, input, user)));
  } catch (e) {
    return errorResponse(e);
  }
}
