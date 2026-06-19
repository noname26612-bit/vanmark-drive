import { requireAnyRole } from "@/lib/session";
import { listActiveDrivers } from "@/domain/users";
import { getCapacitySettings } from "@/domain/capacity-service";
import { getUiPrefs } from "@/domain/ui-prefs-service";
import { todayISO } from "@/lib/task-ui";
import { PlanningClient } from "./planning-client";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const user = await requireAnyRole("DISPATCHER", "ADMIN");
  const [drivers, settings, prefs] = await Promise.all([
    listActiveDrivers(),
    getCapacitySettings(),
    getUiPrefs(user.id),
  ]);
  // workdayMinutes — знаменатель для индикатора загрузки в ячейках (Фаза 2, §14.4);
  // initialRowOrder — персональный порядок строк-пулов (раскладка в аккаунте).
  return (
    <PlanningClient
      drivers={drivers}
      today={todayISO()}
      workdayMinutes={settings.workdayMinutes}
      initialRowOrder={prefs["planning.order"]}
    />
  );
}
