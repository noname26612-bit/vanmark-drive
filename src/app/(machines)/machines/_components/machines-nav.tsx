"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

// Шапка менеджера-сервисника: у него ровно один раздел (PRD §16). Вкладку показываем, а не прячем —
// человек должен видеть, где он находится, и место под будущие разделы уже размечено.
export function MachinesNav() {
  const pathname = usePathname();
  const active = pathname === "/machines" || pathname.startsWith("/machines/");
  return (
    <nav className="flex gap-1 border-b border-neutral-200 bg-white px-4">
      <Link
        href="/machines"
        className={cn(
          "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "border-neutral-900 text-neutral-900"
            : "border-transparent text-neutral-500 hover:text-neutral-800",
        )}
      >
        Станки
      </Link>
    </nav>
  );
}
