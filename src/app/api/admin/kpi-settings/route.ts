import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { getKpiSettings, updateKpiSettings } from "@/domain/kpi-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/kpi-settings — прогрессия и нижний порог. PUT — обновить. Только админ.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(ok(await getKpiSettings()));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const progressionPercent = typeof body.progressionPercent === "number" ? body.progressionPercent : NaN;
    const progressionStartIndex = typeof body.progressionStartIndex === "number" ? body.progressionStartIndex : NaN;
    const floor = body.floor === "ZERO" ? "ZERO" : "SALARY";
    const actBonusAmount = typeof body.actBonusAmount === "number" ? body.actBonusAmount : NaN;
    const actBonusThresholdPercent =
      typeof body.actBonusThresholdPercent === "number" ? body.actBonusThresholdPercent : NaN;
    // Нормо-часы месяца (Сводка v2, 02.07): необязательное поле — если клиент не прислал,
    // сохраняем текущее значение (не перетираем дефолтом).
    const monthNormHours =
      typeof body.monthNormHours === "number" ? body.monthNormHours : (await getKpiSettings()).monthNormHours;
    if (
      !Number.isFinite(progressionPercent) ||
      !Number.isFinite(progressionStartIndex) ||
      !Number.isFinite(actBonusAmount) ||
      !Number.isFinite(actBonusThresholdPercent) ||
      !Number.isFinite(monthNormHours)
    ) {
      throw Errors.validation("Параметры расчёта и бонуса должны быть числами");
    }
    return NextResponse.json(
      ok(
        await updateKpiSettings({
          progressionPercent,
          progressionStartIndex,
          floor,
          actBonusAmount,
          actBonusThresholdPercent,
          monthNormHours,
        }),
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
