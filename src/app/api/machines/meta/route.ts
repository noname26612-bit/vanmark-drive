import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse } from "@/lib/api-route";
import { listResponsibles, nextOurNumber } from "@/domain/machine-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/machines/meta — справочные данные формы: подсказка следующего «77-N» и список
// сотрудников офиса, которых можно назначить ответственными. Одним запросом, чтобы форма
// создания открывалась мгновенно (на площадке связь слабая — лишний round-trip заметен).
export async function GET() {
  try {
    const user = await requireMachineUser();
    const [nextNumber, responsibles] = await Promise.all([
      nextOurNumber(user),
      listResponsibles(user),
    ]);
    return NextResponse.json(ok({ nextOurNumber: nextNumber, responsibles }));
  } catch (e) {
    return errorResponse(e);
  }
}
