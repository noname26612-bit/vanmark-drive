import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import {
  listUserAccess,
  setDriverEquipmentAccess,
  setUserLoginAccess,
  setDriverExternal,
  setDriverStaffTasksAccess,
} from "@/domain/users";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/drivers — учётки с признаками доступа: офис (админ, диспетчер, менеджер-сервисник)
// и водители. Сотрудников без входа (EMPLOYEE) здесь нет. Только админ.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(ok(await listUserAccess()));
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/admin/drivers — одно действие за раз, только админ:
//  • { userId, canLogin } — включить/выключить вход (02.07: внешнему перевозчику вход включается
//    здесь осознанно; 22.08: и учёткам офиса). Себе и последнему админу вход не закрывают —
//    проверки в домене, личность действующего берётся из СЕССИИ, не из тела;
//  • { userId, isExternal } — пометить внешним перевозчиком / вернуть в штат (03.08);
//  • { userId, equipmentAccess } — выдать/снять доступ к разделам оборудования (15.08: Николай
//    и Александр; роль при этом остаётся DRIVER);
//  • { userId, staffTasksAccess } — выдать/снять доступ к задачам сотрудникам, цех и снабжение
//    (15.08, вечер): кому их можно ставить и кто видит их у себя в телефоне.
//
// Роль проверяется в домене: вход и пароль — учёткам со входом (MANAGED_ROLES), а три водительских
// признака — по-прежнему только роли DRIVER; всё остальное → 404.
export async function PATCH(req: Request) {
  try {
    const actor = await requireAdmin();
    const body = await readJson(req);
    // `driverId` принимаем как устаревшее имя: у открытых вкладок админки в поле уходит оно.
    const userId =
      typeof body.userId === "string"
        ? body.userId
        : typeof body.driverId === "string"
          ? body.driverId
          : "";
    if (!userId) throw Errors.validation("Не указан пользователь");
    const hasLogin = typeof body.canLogin === "boolean";
    const hasExternal = typeof body.isExternal === "boolean";
    const hasEquipment = typeof body.equipmentAccess === "boolean";
    const hasStaffTasks = typeof body.staffTasksAccess === "boolean";
    // Ровно одно действие за запрос: иначе пришлось бы решать, что делать, если половина применилась.
    if ([hasLogin, hasExternal, hasEquipment, hasStaffTasks].filter(Boolean).length > 1) {
      throw Errors.validation("Укажите одно действие");
    }
    if (hasStaffTasks) {
      return NextResponse.json(
        ok(await setDriverStaffTasksAccess(userId, body.staffTasksAccess as boolean)),
      );
    }
    if (hasEquipment) {
      return NextResponse.json(
        ok(await setDriverEquipmentAccess(userId, body.equipmentAccess as boolean)),
      );
    }
    if (hasExternal) {
      return NextResponse.json(ok(await setDriverExternal(userId, body.isExternal as boolean)));
    }
    if (!hasLogin) throw Errors.validation("canLogin должен быть true/false");
    return NextResponse.json(
      ok(await setUserLoginAccess(actor.id, userId, body.canLogin as boolean)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
