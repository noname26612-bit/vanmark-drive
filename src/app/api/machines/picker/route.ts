import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireMachineUser, errorResponse } from "@/lib/api-route";
import { listPickerMachines } from "@/domain/task-machine-service";
import { parseFamily } from "@/lib/machine-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/machines/picker?family=BENDER|SEAMER&q= — компактный список станков для выбора в форме
// заявки (21.08.2026, PRD §16.1). Отдельный лёгкий эндпоинт, а не /api/machines: там строка списка
// тащит комплекты, заметки и дефектовку, а пикеру нужны номер, модель и состояние.
//
// Доступ — тот же гейт, что у всей картотеки (requireMachineUser): это данные модуля оборудования,
// и недопущенному он отдаёт 404, не раскрывая существование раздела.
export async function GET(req: Request) {
  try {
    const user = await requireMachineUser();
    const url = new URL(req.url);
    const machines = await listPickerMachines(
      user,
      parseFamily(url.searchParams.get("family")) ?? "BENDER",
      url.searchParams.get("q") ?? undefined,
    );
    return NextResponse.json(ok({ machines }));
  } catch (e) {
    return errorResponse(e);
  }
}
