import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { DispatcherNav } from "./_components/dispatcher-nav";

// Экраны диспетчера доступны диспетчеру и админу (PRD §2: админ = всё + управление).
export default async function DispatcherLayout({ children }: { children: ReactNode }) {
  const user = await requireAnyRole("DISPATCHER", "ADMIN");
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader name={user.name} role={user.role} />
      <DispatcherNav showAdmin={user.role === "ADMIN"} />
      {children}
    </div>
  );
}
