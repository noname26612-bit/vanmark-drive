import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { PwaControls } from "@/components/pwa-controls";
import { DispatcherNav } from "./_components/dispatcher-nav";
import { TaskDraftsProvider } from "./_components/task-drafts";

// Экраны диспетчера доступны диспетчеру и админу (PRD §2: админ = всё + управление), а с 11.08.2026 —
// и менеджеру-сервиснику: он ведёт заявки. Денежные разделы («Сводка», «KPI/Зарплата», «Расценка») и
// админка закрыты собственными guard'ами страниц — layout их не открывает.
export default async function DispatcherLayout({ children }: { children: ReactNode }) {
  const user = await requireAnyRole("DISPATCHER", "ADMIN", "SERVICE_MANAGER");
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader name={user.name} role={user.role} position={user.position} />
      <PwaControls />
      <DispatcherNav role={user.role} />
      {/* Черновики свёрнутых заявок (доработка №1): провайдер + плашка снизу, общие для всех экранов диспетчера. */}
      <TaskDraftsProvider>{children}</TaskDraftsProvider>
    </div>
  );
}
