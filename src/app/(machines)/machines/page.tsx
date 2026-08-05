import { MachinesClient } from "./machines-client";

export const dynamic = "force-dynamic";

// Картотека станков (PRD §16). Данные грузит клиент через /api/machines — так экран одинаково
// работает и у Максима с телефона, и у Милены с компьютера, и обновляется без перезагрузки.
export default function MachinesPage() {
  return <MachinesClient />;
}
