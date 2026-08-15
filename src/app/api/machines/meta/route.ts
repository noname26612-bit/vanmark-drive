import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse } from "@/lib/api-route";
import { listKnownModels, listResponsibles, nextNumbers } from "@/domain/machine-service";
import { parseFamily } from "@/lib/machine-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/machines/meta?family=BENDER|SEAMER — справочные данные формы: подсказки следующего
// свободного номера В ЭТОМ разделе — сразу по обеим схемам («77-N» для своего железа, «К-N» для
// клиентского: категорию в форме переключают, и подсказка обязана меняться без второго запроса),
// список сотрудников офиса для поля «Ответственный» и реально введённые модели (сырьё подсказок
// комбобокса — базовый справочник добавляет клиент из machine-models.ts). Одним запросом,
// чтобы форма открывалась мгновенно (на площадке связь слабая — лишний round-trip заметен).
export async function GET(req: Request) {
  try {
    const user = await requireMachineUser();
    const family = parseFamily(new URL(req.url).searchParams.get("family"));
    const [next, responsibles, models] = await Promise.all([
      nextNumbers(user, family),
      listResponsibles(user),
      listKnownModels(user, family),
    ]);
    return NextResponse.json(
      ok({
        nextOurNumber: next.ourNumber,
        nextClientNumber: next.clientNumber,
        responsibles,
        models,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
