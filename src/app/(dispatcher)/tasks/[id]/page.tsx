import { listActiveDrivers } from "@/domain/users";
import { listActiveTaskTypes } from "@/domain/task-type-service";
import { TaskDetailClient } from "./task-detail-client";

// Группа (dispatcher) уже под guard'ом layout'а (диспетчер/админ). Данные карточки клиент
// тянет через SWR (/api/tasks/:id), здесь готовим только справочники для форм/действий.
export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [drivers, types] = await Promise.all([listActiveDrivers(), listActiveTaskTypes()]);
  return <TaskDetailClient taskId={id} drivers={drivers} types={types} />;
}
