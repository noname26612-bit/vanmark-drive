import { EquipmentClient } from "../_components/equipment-client";

export const dynamic = "force-dynamic";

// Раздел «Листогибы» (PRD §16; до 15.08.2026 назывался «Станки»). Данные грузит клиент через
// /api/machines — так экран одинаково работает и у Максима с телефона, и у Милены с компьютера,
// и обновляется без перезагрузки.
export default function BendersPage() {
  return <EquipmentClient family="BENDER" title="Листогибы" basePath="/machines" />;
}
