import { requireRole } from "@/lib/session";
import { DriverTaskClient } from "./task-client";

// Карточка задачи водителя. Данные тянет клиент через SWR (/api/tasks/:id) — там же изоляция:
// чужая задача отдаёт 404 (домен getTaskById → canViewTask). Guard роли — в layout (driver).
export const dynamic = "force-dynamic";

export default async function DriverTaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("DRIVER");
  const { id } = await params;
  return <DriverTaskClient taskId={id} />;
}
