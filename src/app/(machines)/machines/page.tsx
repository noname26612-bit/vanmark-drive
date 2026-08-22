import { EquipmentClient } from "../_components/equipment-client";
import { parseFlag } from "@/lib/machine-input";

export const dynamic = "force-dynamic";

// Раздел «Листогибы» (PRD §16; до 15.08.2026 назывался «Станки»). Данные грузит клиент через
// /api/machines — так экран одинаково работает и у Максима с телефона, и у Милены с компьютера,
// и обновляется без перезагрузки.
//
// `?flag=duePressing|urgent` (22.08.2026) — вход из «Требует внимания» на «Управлении»: список
// сразу отфильтрован тем же счётчиком, по которому пришли. Мусорное значение — обычный список.
export default async function BendersPage({
  searchParams,
}: {
  searchParams: Promise<{ flag?: string | string[] }>;
}) {
  const { flag } = await searchParams;
  const initialFlag = parseFlag(Array.isArray(flag) ? (flag[0] ?? null) : (flag ?? null)) ?? "";
  return (
    <EquipmentClient family="BENDER" title="Листогибы" basePath="/machines" initialFlag={initialFlag} />
  );
}
