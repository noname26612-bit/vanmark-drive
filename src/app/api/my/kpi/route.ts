import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDriver, errorResponse } from "@/lib/api-route";
import { getMyKpi, isPayrollDriver } from "@/domain/kpi-service";
import { periodOf } from "@/domain/kpi";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/my/kpi?period=YYYY-MM — расчёт водителя ИЗ СЕССИИ. Изоляция (CLAUDE.md §1, ARCHITECTURE §6):
// driverId = user.id из requireDriver(), никогда из запроса — чужой расчёт получить нельзя.
// Водитель без денежного профиля (Николай, внешний перевозчик) расчёт не ведёт → 404 (02.07),
// как и экран /m/payroll (redirect) — не отдаём пустышку с нулями.
export async function GET(req: Request) {
  try {
    const user = await requireDriver();
    if (!(await isPayrollDriver(user.id))) throw Errors.notFound();
    const period = new URL(req.url).searchParams.get("period") || periodOf(new Date());
    return NextResponse.json(ok(await getMyKpi(user.id, period)));
  } catch (e) {
    return errorResponse(e);
  }
}
