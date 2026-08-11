import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { PwaControls } from "@/components/pwa-controls";
import { DispatcherNav } from "@/app/(dispatcher)/_components/dispatcher-nav";
import { TaskDraftsProvider } from "@/app/(dispatcher)/_components/task-drafts";

// Модуль «Станки» (PRD §16). Guard — БЕЛЫЙ список ролей: менеджер-сервисник, диспетчер, админ.
// Водителя requireAnyRole уводит на его стартовый экран (homeForRole), в модуль он не попадает.
//
// Навигация с 11.08.2026 одна на всех: менеджер-сервисник ведёт ещё и заявки, поэтому ему, как
// диспетчеру и директору, нужны вкладки задач рядом со «Станками». Сам DispatcherNav показывает
// каждой роли только её разделы (белый список внутри), отдельного меню модуля больше нет.
export default async function MachinesLayout({ children }: { children: ReactNode }) {
  const user = await requireAnyRole("SERVICE_MANAGER", "DISPATCHER", "ADMIN");
  const isStaff = user.role === "DISPATCHER" || user.role === "ADMIN";
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader name={user.name} role={user.role} position={user.position} />
      {/* Установку приложения предлагаем всем (Максим работает с Android), а уведомления — только
          тем, кому их реально шлют: пуши таргетированы по ролям и менеджера-сервисника не достают. */}
      <PwaControls withPush={isStaff} />
      <DispatcherNav role={user.role} />
      {/* Черновики свёрнутых заявок доступны и здесь: без провайдера плашка с черновиком пропадала
          при заходе на «Станки» и возвращалась только на вкладках задач — выглядело как потеря. */}
      <TaskDraftsProvider>{children}</TaskDraftsProvider>
    </div>
  );
}
