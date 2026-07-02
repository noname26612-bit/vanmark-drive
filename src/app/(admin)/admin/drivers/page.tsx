import { requireRole } from "@/lib/session";
import { DriversClient } from "./drivers-client";

export const dynamic = "force-dynamic";

// «Водители — доступ» (02.07): включить/выключить вход водителю. Появился ради внешнего
// перевозчика — вход ему включается осознанно (PRD §2). Только админ.
export default async function DriversPage() {
  await requireRole("ADMIN");
  return <DriversClient />;
}
