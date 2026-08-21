import { requireAnyRole } from "@/lib/session";
import { isTeamManagerRole } from "@/domain/team-access";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

// Вкладка «Команда» (PRD §18, решение Артёма 18.08.2026): справочник коллектива — дни рождения
// и отпуска. С 21.08.2026 (решение Артёма) менеджер-сервисник не только смотрит, но и ведёт записи
// наравне с диспетчером: смотрит и правит один и тот же белый список ролей (team-access.ts),
// поэтому здесь canManage совпадает с guard'ом страницы — и разъезжаться им нечем.
export default async function TeamPage() {
  const user = await requireAnyRole("DISPATCHER", "ADMIN", "SERVICE_MANAGER");
  return <TeamClient canManage={isTeamManagerRole(user.role)} />;
}
