import { UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

// Бейдж «кто поставил заявку» (решение Артёма 11.08.2026). Постановщиков стало двое — Милена и
// Максим, — и на доске нужно понимать, чья это заявка, не открывая карточку.
//
// Оформление намеренно тихое (серый контур, мелкий шрифт): это справочная подпись, она не должна
// спорить со статус-цветом и денежными чипами (ui-guidelines: цветом кодируем только состояние).
// Имя сокращаем до первого слова — на узкой карточке «Планирования» полное не помещается.
export function AuthorBadge({ name, className }: { name?: string | null; className?: string }) {
  const short = shortName(name);
  if (!short) return null;
  return (
    <span
      data-testid="author-badge"
      title={`Заявку создал: ${name}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded border border-neutral-200 bg-neutral-50",
        "px-1 py-px text-[11px] font-medium text-neutral-500 align-middle",
        className,
      )}
    >
      <UserRound className="h-3 w-3" />
      {short}
    </span>
  );
}

/** «Милена Петрова» → «Милена». Пустое/отсутствующее имя — бейджа нет. */
export function shortName(name?: string | null): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}
