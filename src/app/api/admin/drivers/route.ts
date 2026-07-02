import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { listDriverAccess, setDriverLoginAccess } from "@/domain/users";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/drivers — водители с признаками доступа (вход/внешний/на окладе). Только админ.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(ok(await listDriverAccess()));
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/admin/drivers { driverId, canLogin } — включить/выключить вход водителю (02.07:
// внешнему перевозчику вход включается здесь осознанно). Только админ.
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const driverId = typeof body.driverId === "string" ? body.driverId : "";
    if (!driverId) throw Errors.validation("Не указан водитель");
    if (typeof body.canLogin !== "boolean") throw Errors.validation("canLogin должен быть true/false");
    return NextResponse.json(ok(await setDriverLoginAccess(driverId, body.canLogin)));
  } catch (e) {
    return errorResponse(e);
  }
}
