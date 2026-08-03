import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { listDriverAccess, setDriverLoginAccess, setDriverExternal } from "@/domain/users";
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

// PATCH /api/admin/drivers — одно действие за раз, только админ:
//  • { driverId, canLogin } — включить/выключить вход (02.07: внешнему перевозчику вход включается
//    здесь осознанно);
//  • { driverId, isExternal } — пометить внешним перевозчиком / вернуть в штат (03.08).
// Роль проверяется в домене: менять можно только пользователя с ролью DRIVER.
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const driverId = typeof body.driverId === "string" ? body.driverId : "";
    if (!driverId) throw Errors.validation("Не указан водитель");
    const hasLogin = typeof body.canLogin === "boolean";
    const hasExternal = typeof body.isExternal === "boolean";
    if (hasLogin && hasExternal) throw Errors.validation("Укажите одно действие");
    if (hasExternal) {
      return NextResponse.json(ok(await setDriverExternal(driverId, body.isExternal as boolean)));
    }
    if (!hasLogin) throw Errors.validation("canLogin должен быть true/false");
    return NextResponse.json(ok(await setDriverLoginAccess(driverId, body.canLogin as boolean)));
  } catch (e) {
    return errorResponse(e);
  }
}
