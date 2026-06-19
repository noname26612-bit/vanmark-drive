import { requireAnyRole } from "@/lib/session";
import { listActiveDrivers } from "@/domain/users";
import { listActiveTaskTypes } from "@/domain/task-type-service";
import { getUiPrefs } from "@/domain/ui-prefs-service";
import { todayISO } from "@/lib/task-ui";
import { BoardClient } from "./board-client";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const user = await requireAnyRole("DISPATCHER", "ADMIN");
  // Раскладка пулов грузится на сервере вместе с данными — чтобы при открытии не мигал
  // дефолтный порядок до подгрузки настроек (раскладка привязана к пользователю, PRD §8).
  const [drivers, types, prefs] = await Promise.all([
    listActiveDrivers(),
    listActiveTaskTypes(),
    getUiPrefs(user.id),
  ]);
  return (
    <BoardClient
      drivers={drivers}
      types={types}
      today={todayISO()}
      initialOrder={prefs["board.order"]}
      initialCollapsed={prefs["board.collapsed"]}
    />
  );
}
