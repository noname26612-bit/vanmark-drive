"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Единое поле поиска задач для вкладок диспетчера («Сегодня», «Все задачи», «Планирование»).
 * UX по практикам GitHub/Linear: хоткей «/» фокусирует поле (когда фокус не в другом инпуте),
 * Esc очищает и снимает фокус, крестик очищает, рядом живой счётчик «Найдено N».
 */
export function TaskSearchInput({
  value,
  onChange,
  found,
  placeholder = "Поиск: № / телефон / адрес / текст",
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  found?: number | null; // null/undefined — счётчик не показываем
  placeholder?: string;
  className?: string;
  inputClassName?: string; // ширина инпута по месту (по умолчанию w-72)
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const active = value.trim().length > 0;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div className={cn("relative", inputClassName ?? "w-72")}>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          ref={ref}
          type="text"
          value={value}
          data-testid="task-search"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onChange("");
              ref.current?.blur();
            }
          }}
          placeholder={placeholder}
          aria-label="Поиск задач"
          className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-8 pr-8 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-900"
        />
        {active ? (
          <button
            type="button"
            aria-label="Очистить поиск"
            data-testid="task-search-clear"
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-neutral-200 bg-neutral-50 px-1 font-sans text-[10px] text-neutral-400 sm:block">
            /
          </kbd>
        )}
      </div>
      {active && found !== null && found !== undefined ? (
        <span
          data-testid="task-search-count"
          className={cn(
            "whitespace-nowrap text-xs tabular-nums",
            found === 0 ? "font-medium text-amber-700" : "text-neutral-500",
          )}
        >
          {found === 0 ? "Ничего не найдено" : `Найдено: ${found}`}
        </span>
      ) : null}
    </div>
  );
}
