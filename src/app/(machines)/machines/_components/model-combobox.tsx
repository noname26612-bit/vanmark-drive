"use client";

// Поле «Модель» с умным подбором (PRD §16.5): под инпутом — фильтруемый список подсказок
// (базовый справочник 25 моделей + реально введённые в картотеке). Подбор понимает часть слова,
// неверную раскладку (search-core) и другой алфавит («лбм» → Sorex LBM, транслит в
// machine-models.ts). Выбирать из списка не обязательно: значение поля — просто текст инпута,
// своё название вписывается как раньше. Голый datalist не подошёл — его фильтрация браузерная,
// без раскладки и транслита.
import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Highlighted } from "@/components/highlight";
import { filterModelSuggestions } from "@/domain/machine-models";
import { parseQuery } from "@/lib/search-core";

export function ModelCombobox({
  value,
  onChange,
  models,
  placeholder,
  testId,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Готовый пул подсказок (modelSuggestionPool: базовые + из БД). */
  models: string[];
  placeholder?: string;
  testId?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // индекс подсвеченного пункта; -1 — ничего
  const listRef = useRef<HTMLUListElement>(null);

  const suggestions = useMemo(() => filterModelSuggestions(models, value), [models, value]);
  const query = useMemo(() => parseQuery(value), [value]);

  function choose(label: string) {
    onChange(label);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = (active + delta + suggestions.length) % suggestions.length;
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter" && open && active >= 0 && active < suggestions.length) {
      // Enter выбирает только явно подсвеченный стрелками пункт — обычный Enter форму не трогаем.
      e.preventDefault();
      choose(suggestions[active]);
    }
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        // Клик по подсказке идёт через onMouseDown с preventDefault, поэтому blur здесь означает
        // настоящий уход из поля — список можно закрывать сразу, клики не теряются.
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        data-testid={testId}
      />
      {open && suggestions.length > 0 ? (
        <ul
          ref={listRef}
          role="listbox"
          data-testid={testId ? `${testId}-list` : undefined}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // preventDefault удерживает фокус в инпуте: без него blur закрыл бы список до click.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(label);
                }}
                className={`block w-full px-3 py-2.5 text-left text-sm text-neutral-800 ${
                  i === active ? "bg-neutral-100" : "active:bg-neutral-100"
                }`}
              >
                <Highlighted text={label} query={query} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
