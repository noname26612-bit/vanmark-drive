import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, errorResponse, readJson } from "@/lib/api-route";
import { deactivateEmployee, updateTeamMember, type TeamMemberPatch } from "@/domain/team-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/team/:id — правка карточки сотрудника (PRD §18). Только диспетчер/админ.
// Патч собираем по БЕЛОМУ списку ключей: «прислали поле» и «не прислали» — разные вещи, и лишнее
// поле у учётки с доступом должно дать понятный отказ, а не молча потеряться.
// Роль, логин, вход и флаги доступа не принимаются вовсе — это «Управление», а не справочник коллег.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireDispatcher();
    const { id } = await params;
    const body = await readJson(req);
    const patch: TeamMemberPatch = {};
    if ("name" in body) patch.name = typeof body.name === "string" ? body.name : "";
    if ("position" in body) patch.position = typeof body.position === "string" ? body.position : null;
    if ("phone" in body) patch.phone = typeof body.phone === "string" ? body.phone : null;
    if ("birthday" in body) patch.birthday = typeof body.birthday === "string" ? body.birthday : null;
    return NextResponse.json(
      ok(await updateTeamMember(id, patch, { id: user.id, role: user.role })),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/team/:id — убрать сотрудника из справочника. Не удаление строки, а отметка «не
// работает» (isActive=false): отпуска и история остаются. Только для заведённых здесь (EMPLOYEE) —
// учётки с доступом отключают в «Управлении».
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireDispatcher();
    const { id } = await params;
    await deactivateEmployee(id, { id: user.id, role: user.role });
    return NextResponse.json(ok({ id }));
  } catch (e) {
    return errorResponse(e);
  }
}
