import type { ReactNode } from "react";
import { requireRole } from "@/lib/session";
import { AppHeader } from "@/components/app-header";

// PWA водителя — узкая колонка под телефон. Guard: только роль DRIVER.
export default async function DriverLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("DRIVER");
  return (
    <div className="mx-auto min-h-screen max-w-md bg-white">
      <AppHeader name={user.name} role={user.role} />
      {children}
    </div>
  );
}
