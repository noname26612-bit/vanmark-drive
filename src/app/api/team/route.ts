import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireDispatcher, requireTaskManager, errorResponse, readJson } from "@/lib/api-route";
import { createEmployee, getTeamSnapshot } from "@/domain/team-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/team — справочник коллектива: люди, их дни рождения и незакрытые отпуска (PRD §18).
// Смотрят все, кто ведёт заявки (диспетчер, админ, менеджер-сервисник) — это общий календарь
// команды. Водителю сюда нельзя: у него в приложении такого раздела нет.
export async function GET() {
  try {
    await requireTaskManager();
    return NextResponse.json(ok(await getTeamSnapshot()));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/team {name, position?, phone?, birthday?} — завести сотрудника БЕЗ доступа в систему.
// Только диспетчер/админ. Роль (EMPLOYEE) и «вход запрещён» ставит сервис: из тела они не приходят,
// иначе через справочник коллег можно было бы создать себе учётку с правами.
export async function POST(req: Request) {
  try {
    const user = await requireDispatcher();
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name : "";
    if (!name.trim()) throw Errors.validation("Укажите имя сотрудника");
    const position = typeof body.position === "string" ? body.position : null;
    const phone = typeof body.phone === "string" ? body.phone : null;
    const birthday = typeof body.birthday === "string" ? body.birthday : null;
    return NextResponse.json(
      ok(await createEmployee({ name, position, phone, birthday }, { id: user.id, role: user.role })),
      { status: 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
