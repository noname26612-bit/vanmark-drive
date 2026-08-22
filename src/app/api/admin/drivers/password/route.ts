import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { setUserPassword } from "@/domain/users";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/drivers/password { userId, newPassword } — задать новый пароль (03.08 —
// водителям, 22.08 — и учёткам офиса: Милене, Максиму, Михаилу). Раньше пароль офиса менялся
// только запросом к базе на сервере.
//
// Безопасность: только админ; менять можно ТОЛЬКО учётку со входом (MANAGED_ROLES — проверка в
// домене, EMPLOYEE и несуществующий id → 404). Пароль принимается только в теле запроса (никогда
// в URL), не логируется и не возвращается в ответе; хранится argon2id-хэшем.
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    // `driverId` — устаревшее имя поля, принимаем ради открытых вкладок админки.
    const userId =
      typeof body.userId === "string"
        ? body.userId
        : typeof body.driverId === "string"
          ? body.driverId
          : "";
    if (!userId) throw Errors.validation("Не указан пользователь");
    if (typeof body.newPassword !== "string") throw Errors.validation("Введите пароль");
    return NextResponse.json(ok(await setUserPassword(userId, body.newPassword)));
  } catch (e) {
    return errorResponse(e);
  }
}
