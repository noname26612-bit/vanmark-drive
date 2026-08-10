import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse } from "@/lib/api-route";
import { listKnownModels, listResponsibles, nextOurNumber } from "@/domain/machine-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/machines/meta — справочные данные формы: подсказка следующего «77-N», список
// сотрудников офиса для поля «Ответственный» и реально введённые модели (сырьё подсказок
// комбобокса — базовый справочник добавляет клиент из machine-models.ts). Одним запросом,
// чтобы форма открывалась мгновенно (на площадке связь слабая — лишний round-trip заметен).
export async function GET() {
  try {
    const user = await requireMachineUser();
    const [nextNumber, responsibles, models] = await Promise.all([
      nextOurNumber(user),
      listResponsibles(user),
      listKnownModels(user),
    ]);
    return NextResponse.json(ok({ nextOurNumber: nextNumber, responsibles, models }));
  } catch (e) {
    return errorResponse(e);
  }
}
