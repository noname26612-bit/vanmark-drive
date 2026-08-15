import { requireAnyRole } from "@/lib/session";
import { listStaffPerformers } from "@/domain/users";
import { getUiPrefs } from "@/domain/ui-prefs-service";
import { StaffBoardClient } from "./staff-client";

export const dynamic = "force-dynamic";

/**
 * «Сотрудники» — доска задач второго контура (цех и снабжение), решение Артёма 15.08.2026.
 * Ставят их те же, кто ведёт заявки водителям: Милена, Максим и админы.
 */
export default async function StaffPage() {
  const user = await requireAnyRole("DISPATCHER", "ADMIN", "SERVICE_MANAGER");
  const [performers, prefs] = await Promise.all([listStaffPerformers(), getUiPrefs(user.id)]);

  return (
    <StaffBoardClient
      performers={performers}
      order={prefs["staff.order"] ?? []}
      collapsed={prefs["staff.collapsed"] ?? []}
    />
  );
}
