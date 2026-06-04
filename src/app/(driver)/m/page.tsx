import { requireRole } from "@/lib/session";
import { DriverTasksClient } from "./tasks-client";

// «Мои задачи» водителя. Guard роли — в layout группы (driver); здесь подстраховываемся ещё раз.
export const dynamic = "force-dynamic";

export default async function DriverHomePage() {
  await requireRole("DRIVER");
  return <DriverTasksClient />;
}
