"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Выбор одного значения строками с галочкой — замена выпадающему списку (решение Артёма
 * 20.08.2026: «мне очень не нравятся выпадающие списки, лучше оформлять по-другому»).
 *
 * Годится там, где вариантов единицы: вид оборудования, ответственный менеджер. Весь набор виден
 * сразу, выбранное подсвечено — не нужно открывать список, чтобы узнать, из чего вообще выбирают.
 * Если вариантов станет много (десятки), это перестанет работать — тогда нужен поиск, а не список.
 */
export function ChoiceRows({
  value,
  options,
  onChange,
  ariaLabel,
  testIdPrefix,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  ariaLabel: string;
  testIdPrefix?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-col rounded-lg border border-neutral-300 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value || "none"}` : undefined}
            className={cn(
              "flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
              active
                ? "bg-neutral-100 font-medium text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-50",
            )}
          >
            <span className="min-w-0 truncate">{o.label}</span>
            {active ? <Check className="h-4 w-4 shrink-0 text-neutral-900" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
