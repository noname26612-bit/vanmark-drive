import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireApiUser, errorResponse, readJson } from "@/lib/api-route";
import { Errors } from "@/domain/errors";
import { isUiPrefKey } from "@/domain/ui-prefs";
import { getUiPrefs, setUiPref } from "@/domain/ui-prefs-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ui-prefs — персональная раскладка экранов текущего пользователя (порядок/свёрнутость пулов).
// userId — из сессии (изоляция): пользователь читает только свои настройки.
export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json(ok(await getUiPrefs(user.id)));
  } catch (e) {
    return errorResponse(e);
  }
}

// PUT /api/ui-prefs — сохранить одну настройку { key, value }. key — из белого списка, value — массив
// строк-ключей пулов (санируется в домене). userId — из сессии, не из тела.
export async function PUT(req: Request) {
  try {
    const user = await requireApiUser();
    const body = await readJson(req);
    const key = body.key;
    if (typeof key !== "string" || !isUiPrefKey(key)) {
      throw Errors.validation("Неизвестная настройка интерфейса");
    }
    const value = await setUiPref(user.id, key, body.value);
    return NextResponse.json(ok({ key, value }));
  } catch (e) {
    return errorResponse(e);
  }
}
