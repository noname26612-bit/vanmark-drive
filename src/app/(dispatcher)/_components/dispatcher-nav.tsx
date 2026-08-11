"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { PRICING_ENABLED } from "@/lib/features";
import type { Role } from "@/domain/roles";

// Вкладка «Расценка» скрыта под флагом PRICING_ENABLED (06.07): процессом пока не пользуются.
// Вернуть — включить флаг в src/lib/features.ts.
//
// `roles` у каждой вкладки — БЕЛЫЙ список (11.08.2026, вместе с расширением прав менеджера-
// сервисника). Меню обязано совпадать с серверными guard'ами: показать вкладку, ведущую на
// redirect, — это баг интерфейса. Новая роль по умолчанию не видит ничего, пока её не впишут.
const TASK_ROLES: readonly Role[] = ["DISPATCHER", "ADMIN", "SERVICE_MANAGER"];
const STAFF_ROLES: readonly Role[] = ["DISPATCHER", "ADMIN"];
const MACHINE_ROLES: readonly Role[] = ["DISPATCHER", "ADMIN", "SERVICE_MANAGER"];

const LINKS: { href: string; label: string; roles: readonly Role[] }[] = [
  { href: "/board", label: "Сегодня", roles: TASK_ROLES },
  { href: "/planning", label: "Планирование", roles: TASK_ROLES },
  { href: "/capacity", label: "Календарь", roles: TASK_ROLES },
  { href: "/tasks", label: "Все задачи", roles: TASK_ROLES },
  ...(PRICING_ENABLED ? [{ href: "/pricing", label: "Расценка", roles: STAFF_ROLES }] : []),
  { href: "/summary", label: "Сводка", roles: STAFF_ROLES },
  { href: "/kpi", label: "KPI / Зарплата", roles: STAFF_ROLES },
  // Картотека станков (05.08.2026, PRD §16): у Милены те же права, что у менеджера-сервисника.
  { href: "/machines", label: "Станки", roles: MACHINE_ROLES },
  { href: "/admin", label: "Управление", roles: ["ADMIN"] },
];

export function DispatcherNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => l.roles.includes(role));

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
