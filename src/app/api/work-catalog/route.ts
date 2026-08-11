import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse } from "@/lib/api-route";
import { listWorkCatalog } from "@/domain/work-service";
import { Errors } from "@/domain/errors";
import type { Role } from "@/domain/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/work-catalog — активные работы для выбора в ведомости (водитель/диспетчер/админ).
// Роль проверяем БЕЛЫМ списком (05.08.2026, ввод роли SERVICE_MANAGER): раньше хватало факта
// входа, и любая новая роль автоматически получала справочник, к работе с которым отношения не
// имеет. Ведомости заполняют только водители, расценивает диспетчер — им и отдаём. Менеджер-
// сервисник ведёт заявки (11.08.2026), но ведомость ему доступна только на просмотр — справочник
// для заполнения не нужен. Список записан перечислением, а не отрицаниями: следующая роль по
// умолчанию не попадает сюда, пока её не впишут явно.
const CATALOG_ROLES: readonly Role[] = ["DRIVER", "DISPATCHER", "ADMIN"];

export async function GET() {
  try {
    const user = await requireApiUser();
    if (!CATALOG_ROLES.includes(user.role)) throw Errors.forbidden();
    return NextResponse.json(ok(await listWorkCatalog()));
  } catch (e) {
    return errorResponse(e);
  }
}
