import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Размеры бейджа. sm — стандарт (плотная доска, списки). md — крупнее и заметнее (напр. активная
// задача «В работе»: решение Артёма 07.07 — прежний мелкий бейдж почти терялся). Размер задаёт
// один класс паддинга+шрифта, чтобы не было конфликта утилит при склейке (cn — простой join).
const BADGE_SIZE = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
} as const;

export function Badge({
  className,
  size = "sm",
  children,
}: {
  className?: string;
  size?: keyof typeof BADGE_SIZE;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center rounded font-medium", BADGE_SIZE[size], className)}>
      {children}
    </span>
  );
}
