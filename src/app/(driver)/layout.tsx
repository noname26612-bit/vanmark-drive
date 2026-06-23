import type { ReactNode } from "react";
import { requireRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { PwaControls } from "@/components/pwa-controls";

// PWA водителя — узкая колонка под телефон. Guard: только роль DRIVER.
export default async function DriverLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("DRIVER");
  return (
    <div className="mx-auto min-h-screen max-w-md bg-white">
      <AppHeader name={user.name} role={user.role} position={user.position} />
      <PwaControls />
      {children}
    </div>
  );
}
