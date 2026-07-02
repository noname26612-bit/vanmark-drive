import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import { createIdleNote, listIdleNotes } from "@/domain/idle-note-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/idle-notes?from=YYYY-MM-DD&to=YYYY-MM-DD — пометки о простое за диапазон.
// Только диспетчер/админ: водителю пометки не видны ни в каком виде (решение Артёма 02.07).
export async function GET(req: Request) {
  try {
    await requireDispatcher();
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? from;
    return NextResponse.json(ok(await listIdleNotes({ from, to })));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/idle-notes { driverId, date, minutes, note? } — внести пометку о простое.
export async function POST(req: Request) {
  try {
    const user = await requireDispatcher();
    const body = await readJson(req);
    const driverId = typeof body.driverId === "string" ? body.driverId : "";
    const date = typeof body.date === "string" ? body.date : "";
    const minutes = typeof body.minutes === "number" ? Math.trunc(body.minutes) : NaN;
    const note = typeof body.note === "string" ? body.note : null;
    if (!driverId) throw Errors.validation("Не указан водитель");
    if (!Number.isFinite(minutes)) throw Errors.validation("Не указаны минуты простоя");
    return NextResponse.json(ok(await createIdleNote({ driverId, date, minutes, note }, user)), {
      status: 201,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
