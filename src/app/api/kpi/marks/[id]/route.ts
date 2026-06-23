import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse } from "@/lib/api-route";
import { getMarkDetail } from "@/domain/kpi-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/kpi/marks/:id — детали нарушения для drill-down (доработка №1): разбор «почему засчиталось».
// Только диспетчер/админ. Личность из сессии; чувствительного (пути к файлам) не отдаём.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireDispatcher();
    const { id } = await params;
    return NextResponse.json(ok(await getMarkDetail(id)));
  } catch (e) {
    return errorResponse(e);
  }
}
