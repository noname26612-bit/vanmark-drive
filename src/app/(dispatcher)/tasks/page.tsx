import { listActiveDrivers } from "@/domain/users";
import { listActiveTaskTypes } from "@/domain/task-type-service";
import { AllTasksClient } from "./all-tasks-client";

export const dynamic = "force-dynamic";

export default async function AllTasksPage() {
  const [drivers, types] = await Promise.all([listActiveDrivers(), listActiveTaskTypes()]);
  return <AllTasksClient drivers={drivers} types={types} />;
}
