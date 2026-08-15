import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import {
  listDriverAccess,
  setDriverEquipmentAccess,
  setDriverLoginAccess,
  setDriverExternal,
} from "@/domain/users";
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
//  • { driverId, isExternal } — пометить внешним перевозчиком / вернуть в штат (03.08);
//  • { driverId, equipmentAccess } — выдать/снять доступ к разделам оборудования (15.08: Николай
//    и Александр; роль при этом остаётся DRIVER).
// Роль проверяется в домене: менять можно только пользователя с ролью DRIVER.
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const driverId = typeof body.driverId === "string" ? body.driverId : "";
    if (!driverId) throw Errors.validation("Не указан водитель");
    const hasLogin = typeof body.canLogin === "boolean";
    const hasExternal = typeof body.isExternal === "boolean";
    const hasEquipment = typeof body.equipmentAccess === "boolean";
    // Ровно одно действие за запрос: иначе пришлось бы решать, что делать, если половина применилась.
    if ([hasLogin, hasExternal, hasEquipment].filter(Boolean).length > 1) {
      throw Errors.validation("Укажите одно действие");
    }
    if (hasEquipment) {
      return NextResponse.json(
        ok(await setDriverEquipmentAccess(driverId, body.equipmentAccess as boolean)),
      );
    }
    if (hasExternal) {
      return NextResponse.json(ok(await setDriverExternal(driverId, body.isExternal as boolean)));
    }
    if (!hasLogin) throw Errors.validation("canLogin должен быть true/false");
    return NextResponse.json(ok(await setDriverLoginAccess(driverId, body.canLogin as boolean)));
  } catch (e) {
    return errorResponse(e);
  }
}
