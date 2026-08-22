"use client";

import { cn } from "@/lib/cn";

/**
 * Сегмент-переключатель («День · Неделя · Месяц») — строками-кнопками, а не выпадашкой
 * (ui-guidelines, решение Артёма 20.08.2026: выбор из 2–4 вариантов всегда виден целиком).
 *
 * Именно `<button aria-pressed>`, а НЕ `role="radio"`: под radio браузер перестаёт отдавать кнопку
 * по роли button, и тесты (и скринридер-навигация «по кнопкам») теряют переключатель.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testIdPrefix,
  className,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  testIdPrefix?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex overflow-hidden rounded-lg border border-neutral-300", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3.5 py-2 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-neutral-900 text-white"
              : "bg-white text-neutral-600 hover:bg-neutral-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
