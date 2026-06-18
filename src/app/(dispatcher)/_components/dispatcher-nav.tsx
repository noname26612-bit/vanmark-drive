"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/board", label: "Сегодня" },
  { href: "/planning", label: "Планирование" },
  { href: "/tasks", label: "Все задачи" },
  { href: "/summary", label: "Сводка" },
  { href: "/kpi", label: "KPI / Зарплата" },
];

export function DispatcherNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const links = showAdmin ? [...LINKS, { href: "/admin", label: "Управление" }] : LINKS;

  return (
    <nav className="flex gap-1 border-b border-neutral-200 bg-white px-4">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-800",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
