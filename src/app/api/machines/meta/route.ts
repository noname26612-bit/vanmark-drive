import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse } from "@/lib/api-route";
import { listKnownModels, listResponsibles, nextOurNumber } from "@/domain/machine-service";
import { parseFamily } from "@/lib/machine-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/machines/meta?family=BENDER|SEAMER — справочные данные формы: подсказка следующего
// свободного «77-N» В ЭТОМ разделе (нумерация не сквозная, решение Артёма 15.08.2026), список
// сотрудников офиса для поля «Ответственный» и реально введённые модели (сырьё подсказок
// комбобокса — базовый справочник добавляет клиент из machine-models.ts). Одним запросом,
// чтобы форма открывалась мгновенно (на площадке связь слабая — лишний round-trip заметен).
export async function GET(req: Request) {
  try {
    const user = await requireMachineUser();
    const family = parseFamily(new URL(req.url).searchParams.get("family"));
    const [nextNumber, responsibles, models] = await Promise.all([
      nextOurNumber(user, family),
      listResponsibles(user),
      listKnownModels(user, family),
    ]);
    return NextResponse.json(ok({ nextOurNumber: nextNumber, responsibles, models }));
  } catch (e) {
    return errorResponse(e);
  }
}
