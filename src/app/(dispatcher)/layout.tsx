import type { ReactNode } from "react";
import { requireRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";

// Все маршруты диспетчера за этим guard'ом: чужая роль уходит на свой экран, гость — на вход.
export default async function DispatcherLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("DISPATCHER");
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader name={user.name} role={user.role} />
      {children}
    </div>
  );
}
