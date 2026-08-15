import type { ReactNode } from "react";
import { requireEquipmentUser } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { PwaControls } from "@/components/pwa-controls";
import { DispatcherNav } from "@/app/(dispatcher)/_components/dispatcher-nav";
import { TaskDraftsProvider } from "@/app/(dispatcher)/_components/task-drafts";

// Разделы оборудования: «Листогибы» (/machines) и «Фальцепрокатники» (/seamers), PRD §16.
//
// Guard — requireEquipmentUser: белый список ролей (менеджер-сервисник, диспетчер, админ) ИЛИ
// персональный флаг equipmentAccess (Николай, Александр — решение Артёма 15.08.2026). Водителя
// без флага уводит на его стартовый экран, в раздел он не попадает.
//
// Навигация с 11.08.2026 одна на всех: менеджер-сервисник ведёт ещё и заявки, поэтому ему, как
// диспетчеру и директору, нужны вкладки задач рядом с оборудованием. Сам DispatcherNav показывает
// каждому только его разделы; водителю с флагом — ровно две вкладки оборудования.
export default async function MachinesLayout({ children }: { children: ReactNode }) {
  const user = await requireEquipmentUser();
  const isStaff = user.role === "DISPATCHER" || user.role === "ADMIN";
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader name={user.name} role={user.role} position={user.position} />
      {/* Установку приложения предлагаем всем (Максим работает с Android), а уведомления — только
          тем, кому их реально шлют: пуши таргетированы по ролям и менеджера-сервисника не достают. */}
      <PwaControls withPush={isStaff} />
      <DispatcherNav role={user.role} equipmentAccess={user.equipmentAccess} />
      {/* Черновики свёрнутых заявок доступны и здесь: без провайдера плашка с черновиком пропадала
          при заходе на оборудование и возвращалась только на вкладках задач — выглядело как потеря. */}
      <TaskDraftsProvider>{children}</TaskDraftsProvider>
    </div>
  );
}
