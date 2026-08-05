import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { PwaControls } from "@/components/pwa-controls";
import { DispatcherNav } from "@/app/(dispatcher)/_components/dispatcher-nav";
import { MachinesNav } from "./machines/_components/machines-nav";

// Модуль «Станки» (PRD §16). Guard — БЕЛЫЙ список ролей: менеджер-сервисник, диспетчер, админ.
// Водителя requireAnyRole уводит на его стартовый экран (homeForRole), в модуль он не попадает.
//
// Навигация разная по роли: диспетчер и директор приходят сюда из своей обычной шапки и должны
// уметь вернуться к задачам — им показываем привычные вкладки со «Станками». У менеджера-сервисника
// весь сервис — эта картотека (§16), поэтому у него только одна вкладка.
export default async function MachinesLayout({ children }: { children: ReactNode }) {
  const user = await requireAnyRole("SERVICE_MANAGER", "DISPATCHER", "ADMIN");
  const isStaff = user.role === "DISPATCHER" || user.role === "ADMIN";
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader name={user.name} role={user.role} position={user.position} />
      {/* Установку приложения предлагаем всем (Максим работает с Android), а уведомления — только
          тем, кому их реально шлют: пуши таргетированы по ролям и менеджера-сервисника не достают. */}
      <PwaControls withPush={isStaff} />
      {isStaff ? <DispatcherNav showAdmin={user.role === "ADMIN"} /> : <MachinesNav />}
      {children}
    </div>
  );
}
