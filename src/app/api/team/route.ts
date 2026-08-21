import { NextResponse } from "next/server";
import { ok } from "@/lib/api";
import { requireTeamManager, errorResponse, readJson } from "@/lib/api-route";
import { createEmployee, getTeamSnapshot } from "@/domain/team-service";
import { Errors } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/team — справочник коллектива: люди, их дни рождения и незакрытые отпуска (PRD §18).
// Смотрят и правят одни и те же роли (диспетчер, админ, менеджер-сервисник) — весь экран живёт на
// одном белом списке. Водителю сюда нельзя: у него в приложении такого раздела нет.
export async function GET() {
  try {
    await requireTeamManager();
    return NextResponse.json(ok(await getTeamSnapshot()));
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/team {name, position?, phone?, birthday?} — завести сотрудника БЕЗ доступа в систему.
// Диспетчер, админ и менеджер-сервисник (21.08.2026). Роль (EMPLOYEE) и «вход запрещён» ставит
// сервис: из тела они не приходят, иначе через справочник коллег можно было бы создать себе учётку
// с правами.
export async function POST(req: Request) {
  try {
    const user = await requireTeamManager();
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
