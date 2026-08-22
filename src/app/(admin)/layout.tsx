import type { ReactNode } from "react";
import { requireRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { PwaControls } from "@/components/pwa-controls";
import { DispatcherNav } from "@/app/(dispatcher)/_components/dispatcher-nav";
import { TaskDraftsProvider } from "@/app/(dispatcher)/_components/task-drafts";

// Админ (Артём). Guard: только роль ADMIN.
//
// Навигация здесь та же, что на остальных экранах (22.08.2026): до сих пор «Управление» рендерило
// один заголовок без вкладок — попав сюда (а это стартовый экран администратора), уйти можно было
// только по ссылке-карточке или кнопкой «назад». Провайдер черновиков — чтобы плашка свёрнутой
// заявки не пропадала при заходе в админку и не выглядела потерянной.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("ADMIN");
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader name={user.name} role={user.role} position={user.position} />
      <PwaControls />
      <DispatcherNav role={user.role} />
      <TaskDraftsProvider>{children}</TaskDraftsProvider>
    </div>
  );
}
