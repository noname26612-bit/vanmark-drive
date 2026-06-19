import { CapacityCalendarClient } from "./capacity-calendar-client";

export const dynamic = "force-dynamic";

// Вкладка «Календарь загрузки» (Фаза 2, PRD §14.4). Доступ — диспетчер/админ (гейт в (dispatcher)/layout).
export default function CapacityCalendarPage() {
  return <CapacityCalendarClient />;
}
