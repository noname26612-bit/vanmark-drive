import { requireAnyRole } from "@/lib/session";
import { isDispatcherRole } from "@/domain/task-status";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

// Вкладка «Команда» (PRD §18, решение Артёма 18.08.2026): справочник коллектива — дни рождения
// и отпуска. Guard тот же, что у остальных вкладок задач (он же стоит в layout группы), а правка
// доступна только диспетчеру и админу: менеджер-сервисник смотрит, но не ведёт кадровые записи.
export default async function TeamPage() {
  const user = await requireAnyRole("DISPATCHER", "ADMIN", "SERVICE_MANAGER");
  return <TeamClient canManage={isDispatcherRole(user.role)} />;
}
