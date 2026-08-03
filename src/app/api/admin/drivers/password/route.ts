import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { setDriverPassword } from "@/domain/users";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/drivers/password { driverId, newPassword } — задать водителю новый пароль (03.08).
// Раньше пароль можно было сменить только сидом или запросом к базе, поэтому выдать доступ
// нештатному исполнителю без разработчика было нельзя.
//
// Безопасность: только админ; менять можно ТОЛЬКО пользователя с ролью DRIVER (проверка в домене,
// чужая роль → 404) — иначе ручка позволяла бы перехватить учётку диспетчера или админа. Пароль
// принимается только в теле запроса (никогда в URL), не логируется и не возвращается в ответе.
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const driverId = typeof body.driverId === "string" ? body.driverId : "";
    if (!driverId) throw Errors.validation("Не указан водитель");
    if (typeof body.newPassword !== "string") throw Errors.validation("Введите пароль");
    return NextResponse.json(ok(await setDriverPassword(driverId, body.newPassword)));
  } catch (e) {
    return errorResponse(e);
  }
}
