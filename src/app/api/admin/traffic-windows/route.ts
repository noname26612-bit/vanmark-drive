import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin, errorResponse, readJson } from "@/lib/api-route";
import { listTrafficWindows, replaceTrafficWindows, type TrafficWindowInput } from "@/domain/capacity-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/traffic-windows — коэффициенты пробок по времени суток. Только админ.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(ok(await listTrafficWindows()));
  } catch (e) {
    return errorResponse(e);
  }
}

// PUT /api/admin/traffic-windows — заменить набор окон целиком. Только админ.
export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const raw = Array.isArray(body.windows) ? body.windows : null;
    if (!raw) throw Errors.validation("Ожидался массив окон windows");
    const windows: TrafficWindowInput[] = raw.map((w: unknown) => {
      const o = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
      return {
        fromMinutes: typeof o.fromMinutes === "number" ? Math.trunc(o.fromMinutes) : NaN,
        toMinutes: typeof o.toMinutes === "number" ? Math.trunc(o.toMinutes) : NaN,
        factorPercent: typeof o.factorPercent === "number" ? Math.trunc(o.factorPercent) : NaN,
      };
    });
    return NextResponse.json(ok(await replaceTrafficWindows(windows)));
  } catch (e) {
    return errorResponse(e);
  }
}
