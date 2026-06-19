import {
  getCapacitySettings,
  listTrafficWindows,
  listDriversWithSpecialization,
} from "@/domain/capacity-service";
import { CapacityClient } from "./capacity-client";

export const dynamic = "force-dynamic";

// Настройки ёмкости (Фаза 2, PRD §14). Доступ — только ADMIN (гейт в (admin)/layout.tsx).
export default async function CapacityPage() {
  const [settings, windows, drivers] = await Promise.all([
    getCapacitySettings(),
    listTrafficWindows(),
    listDriversWithSpecialization(),
  ]);
  return (
    <CapacityClient
      initialSettings={{
        baseLat: settings.baseLat,
        baseLng: settings.baseLng,
        workdayMinutes: settings.workdayMinutes,
        avgSpeedKmh: settings.avgSpeedKmh,
        detourPercent: settings.detourPercent,
        countReturnTrip: settings.countReturnTrip,
      }}
      initialWindows={windows.map((w) => ({
        fromMinutes: w.fromMinutes,
        toMinutes: w.toMinutes,
        factorPercent: w.factorPercent,
      }))}
      initialDrivers={drivers}
    />
  );
}
