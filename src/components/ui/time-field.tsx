"use client";

import { cn } from "@/lib/cn";

// Поле ввода времени (03.08.2026). Отдельный компонент, потому что нативный `input[type=time]`
// нельзя ставить без собственной ширины: в ряду с растягивающимся соседом (flex-1) он схлопывается,
// а Safari рисует внутри «07:30 PM» плюс иконку часов — сегменты часов и минут обрезаются, и по ним
// физически невозможно попасть курсором (поймано на закрытии смены, 03.08). Ширина и shrink-0 здесь
// не оформление, а работоспособность; step=60 убирает секунды.
export function TimeField({
  value,
  onChange,
  testId,
  disabled,
  className,
}: {
  value: string; // «ЧЧ:ММ» или ""
  onChange: (v: string) => void;
  testId?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="time"
      step={60}
      data-testid={testId}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-[132px] shrink-0 rounded-lg border border-neutral-300 px-2 text-sm tabular-nums",
        "focus:border-neutral-900 focus:outline-none disabled:opacity-50",
        className,
      )}
    />
  );
}
