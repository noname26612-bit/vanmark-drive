import { listAllTaskTypes } from "@/domain/task-type-service";
import { TaskTypesClient } from "./task-types-client";

export const dynamic = "force-dynamic";

export default async function TaskTypesPage() {
  const types = await listAllTaskTypes();
  return <TaskTypesClient initial={types} />;
}
