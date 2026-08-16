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
// Диспетчерский контур (смены, KPI, деньги). Имя намеренно не «STAFF»: «сотрудники» — это отдельный
// контур ЗАДАЧ (вкладка «Цех»), и путать их нельзя.
const DISPATCH_ROLES: readonly Role[] = ["DISPATCHER", "ADMIN"];
const MACHINE_ROLES: readonly Role[] = ["DISPATCHER", "ADMIN", "SERVICE_MANAGER"];

// `equipment: true` — вкладку открывает ещё и персональный флаг User.equipmentAccess (15.08.2026,
// Николай и Александр). Это ЕДИНСТВЕННОЕ исключение из чисто ролевого меню, и оно ровно повторяет
// серверный guard requireEquipmentUser: вкладка, ведущая на redirect, — баг интерфейса.
const LINKS: { href: string; label: string; roles: readonly Role[]; equipment?: boolean }[] = [
  // Два рабочих контура идут рядом и названы по людям, а не по времени (решение Артёма
  // 16.08.2026): «Водители» — заявки на день (бывшая «Сегодня»), «Цех» — задачи сотрудникам (бывшая
  // «Сотрудники»). Пути /board и /staff не меняем: по ним ходят закладки и открытые вкладки.
  { href: "/board", label: "Водители", roles: TASK_ROLES },
  { href: "/staff", label: "Цех", roles: TASK_ROLES },
  { href: "/planning", label: "Планирование", roles: TASK_ROLES },
  { href: "/capacity", label: "Календарь", roles: TASK_ROLES },
  { href: "/tasks", label: "Все задачи", roles: TASK_ROLES },
  ...(PRICING_ENABLED ? [{ href: "/pricing", label: "Расценка", roles: DISPATCH_ROLES }] : []),
  { href: "/summary", label: "Сводка", roles: DISPATCH_ROLES },
  { href: "/kpi", label: "KPI / Зарплата", roles: DISPATCH_ROLES },
  // Разделы оборудования (05.08.2026 — картотека, 15.08.2026 — разделение на два раздела).
  // У Милены те же права, что у менеджера-сервисника.
  { href: "/machines", label: "Листогибы", roles: MACHINE_ROLES, equipment: true },
  { href: "/seamers", label: "Фальцепрокатники", roles: MACHINE_ROLES, equipment: true },
  { href: "/admin", label: "Управление", roles: ["ADMIN"] },
];

export function DispatcherNav({
  role,
  equipmentAccess = false,
}: {
  role: Role;
  equipmentAccess?: boolean;
}) {
  const pathname = usePathname();
  const links = LINKS.filter(
    (l) => l.roles.includes(role) || (l.equipment === true && equipmentAccess),
  );

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
