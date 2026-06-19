import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import {
  getCapacitySettings,
  updateCapacitySettings,
  listDriversWithSpecialization,
  setDriverSpecializations,
} from "@/domain/capacity-service";
import { Errors } from "@/domain/errors";
import type { DriverSpecialization } from "@/generated/prisma/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SPECS: DriverSpecialization[] = ["REPAIR", "DELIVERY", "ANY"];

// GET /api/admin/capacity-settings — настройки расчёта ёмкости + водители со специализацией. Только админ.
export async function GET() {
  try {
    await requireAdmin();
    const [settings, drivers] = await Promise.all([
      getCapacitySettings(),
      listDriversWithSpecialization(),
    ]);
    return NextResponse.json(ok({ settings, drivers }));
  } catch (e) {
    return errorResponse(e);
  }
}

// PUT /api/admin/capacity-settings — обновить настройки и специализацию водителей. Только админ.
export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const s = (body.settings && typeof body.settings === "object" ? body.settings : {}) as Record<string, unknown>;

    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const settingsInput = {
      baseLat: num(s.baseLat),
      baseLng: num(s.baseLng),
      workdayMinutes: Math.trunc(num(s.workdayMinutes)),
      avgSpeedKmh: Math.trunc(num(s.avgSpeedKmh)),
      detourPercent: Math.trunc(num(s.detourPercent)),
      countReturnTrip: s.countReturnTrip === true,
    };
    if (Object.values(settingsInput).some((v) => typeof v === "number" && Number.isNaN(v))) {
      throw Errors.validation("Параметры настроек должны быть числами");
    }
    const settings = await updateCapacitySettings(settingsInput);

    // Специализация водителей: { driverId: "REPAIR" | "DELIVERY" | "ANY" }. Невалидные — отбрасываем.
    const specRaw = (body.specializations && typeof body.specializations === "object"
      ? body.specializations
      : {}) as Record<string, unknown>;
    const map: Record<string, DriverSpecialization> = {};
    for (const [id, v] of Object.entries(specRaw)) {
      if (typeof v === "string" && (SPECS as string[]).includes(v)) map[id] = v as DriverSpecialization;
    }
    if (Object.keys(map).length > 0) await setDriverSpecializations(map);

    const drivers = await listDriversWithSpecialization();
    return NextResponse.json(ok({ settings, drivers }));
  } catch (e) {
    return errorResponse(e);
  }
}
