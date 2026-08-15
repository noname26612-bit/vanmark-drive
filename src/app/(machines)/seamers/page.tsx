import { EquipmentClient } from "../_components/equipment-client";

export const dynamic = "force-dynamic";

// Раздел «Фальцепрокатники» (решение Артёма 15.08.2026): та же механика, что у листогибов, своё
// деление — фальцепрокатники, размотчики, частотники. Экран один и тот же, отличается только
// разделом: разводить два почти одинаковых экрана значило бы чинить каждую правку дважды.
export default function SeamersPage() {
  return <EquipmentClient family="SEAMER" title="Фальцепрокатники" basePath="/seamers" />;
}
