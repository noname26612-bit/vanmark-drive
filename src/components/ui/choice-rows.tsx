"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Выбор одного значения строками с галочкой — замена выпадающему списку (решение Артёма
 * 20.08.2026: «мне очень не нравятся выпадающие списки, лучше оформлять по-другому»).
 *
 * Годится там, где вариантов единицы: вид оборудования, ответственный менеджер, правило автоматики
 * по станку. Весь набор виден сразу, выбранное подсвечено — не нужно открывать список, чтобы узнать,
 * из чего вообще выбирают. Если вариантов станет много (десятки), это перестанет работать — тогда
 * нужен поиск, а не список.
 *
 * Живёт в общих компонентах, а не в разделе оборудования (21.08.2026): тем же выбором теперь
 * пользуется админка типов задач, и вторая копия разъехалась бы с первой.
 */
export function ChoiceRows({
  value,
  options,
  onChange,
  ariaLabel,
  testIdPrefix,
  disabled,
}: {
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (next: string) => void;
  ariaLabel: string;
  testIdPrefix?: string;
  disabled?: boolean;
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
            disabled={disabled}
            onClick={() => onChange(o.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value || "none"}` : undefined}
            className={cn(
              "flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50",
              active
                ? "bg-neutral-100 font-medium text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-50",
            )}
          >
            {/* Пояснение (если есть) — второй строкой: подпись говорит «что это», пояснение —
                «что произойдёт». Без него строка выглядит ровно как раньше. */}
            <span className="min-w-0 flex-1">
              <span className={cn("block", o.hint ? "" : "truncate")}>{o.label}</span>
              {o.hint ? (
                <span className="mt-0.5 block text-xs font-normal text-neutral-500">{o.hint}</span>
              ) : null}
            </span>
            {active ? <Check className="h-4 w-4 shrink-0 text-neutral-900" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
