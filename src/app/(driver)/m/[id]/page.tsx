import { requireRole } from "@/lib/session";
import { isExternalDriver } from "@/domain/users";
import { DriverTaskClient } from "./task-client";

// Карточка задачи водителя. Данные тянет клиент через SWR (/api/tasks/:id) — там же изоляция:
// чужая задача отдаёт 404 (домен getTaskById → canViewTask). Guard роли — в layout (driver).
export const dynamic = "force-dynamic";

export default async function DriverTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("DRIVER");
  const { id } = await params;
  // Внешний перевозчик смен не ведёт (02.07): клиент не грузит смену и не блокирует «В работу».
  const isExternal = await isExternalDriver(user.id);
  return <DriverTaskClient taskId={id} isExternal={isExternal} meId={user.id} />;
}
