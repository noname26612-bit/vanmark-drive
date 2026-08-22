import { EquipmentClient } from "../_components/equipment-client";
import { parseFlag } from "@/lib/machine-input";

export const dynamic = "force-dynamic";

// Раздел «Фальцепрокатники» (решение Артёма 15.08.2026): та же механика, что у листогибов, своё
// деление — фальцепрокатники, размотчики, частотники. Экран один и тот же, отличается только
// разделом: разводить два почти одинаковых экрана значило бы чинить каждую правку дважды.
//
// `?flag=…` — вход из «Требует внимания» на «Управлении» (22.08.2026).
export default async function SeamersPage({
  searchParams,
}: {
  searchParams: Promise<{ flag?: string | string[] }>;
}) {
  const { flag } = await searchParams;
  const initialFlag = parseFlag(Array.isArray(flag) ? (flag[0] ?? null) : (flag ?? null)) ?? "";
  return (
    <EquipmentClient
      family="SEAMER"
      title="Фальцепрокатники"
      basePath="/seamers"
      initialFlag={initialFlag}
    />
  );
}
