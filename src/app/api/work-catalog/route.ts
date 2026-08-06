import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse } from "@/lib/api-route";
import { listWorkCatalog } from "@/domain/work-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/work-catalog — активные работы для выбора в ведомости (водитель/диспетчер/админ).
// Роль проверяем БЕЛЫМ списком (05.08.2026, ввод роли SERVICE_MANAGER): раньше хватало факта
// входа, и любая новая роль автоматически получала справочник, к работе с которым отношения не
// имеет. Ведомости заполняют только водители, расценивает диспетчер — им и отдаём.
export async function GET() {
  try {
    const user = await requireApiUser();
    if (user.role !== "DRIVER" && user.role !== "DISPATCHER" && user.role !== "ADMIN") {
      throw Errors.forbidden();
    }
    return NextResponse.json(ok(await listWorkCatalog()));
  } catch (e) {
    return errorResponse(e);
  }
}
