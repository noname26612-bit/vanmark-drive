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
  // Метка для тестов. TypeScript пропускает любые data-* атрибуты в JSX, поэтому места вызова
  // передавали её и раньше — а до DOM она не доходила, и тест по такому селектору не нашёл бы
  // ничего (16.08.2026: обнаружено на бейдже пары).
  "data-testid": testId,
}: {
  className?: string;
  size?: keyof typeof BADGE_SIZE;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center rounded font-medium", BADGE_SIZE[size], className)}
      data-testid={testId}
    >
      {children}
    </span>
  );
}
