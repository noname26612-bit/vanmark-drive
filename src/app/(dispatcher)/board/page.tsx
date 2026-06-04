import { requireAnyRole } from "@/lib/session";
import { listActiveDrivers } from "@/domain/users";
import { listActiveTaskTypes } from "@/domain/task-type-service";
import { todayISO } from "@/lib/task-ui";
import { BoardClient } from "./board-client";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  await requireAnyRole("DISPATCHER", "ADMIN");
  const [drivers, types] = await Promise.all([listActiveDrivers(), listActiveTaskTypes()]);
  return <BoardClient drivers={drivers} types={types} today={todayISO()} />;
}
