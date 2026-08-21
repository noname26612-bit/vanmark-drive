"use client";

// Категорий у станка может быть несколько (решение Артёма 20.08.2026: «наш на продажу может быть и
// арендным»). Выпадашка такое не выражает — здесь строки с галочками, по одной на категорию.
//
// Правила совместимости живут в домене — здесь их НЕТ ни одной копии (21.08.2026): клик считает
// доменная `toggleCategory` (эксклюзивная категория вытесняет остальные, последнюю галочку снять
// нельзя). Компонент не проверяет набор ПОСЛЕ выбора, а не даёт собрать недопустимый — иначе
// человек упирается в отказ сервера там, где ошибка видна заранее.
import { MACHINE_CATEGORIES, toggleCategory } from "@/domain/machine-status";
import { MACHINE_CATEGORY_LABEL } from "@/lib/machine-ui";
import type { MachineCategory } from "@/generated/prisma/enums";

export function CategoryCheckboxes({
  value,
  onChange,
  disabled,
}: {
  value: MachineCategory[];
  onChange: (next: MachineCategory[]) => void;
  disabled?: boolean;
}) {
  function toggle(category: MachineCategory) {
    const next = toggleCategory(value, category);
    // Клик по единственной галочке ничего не меняет — лишний запрос на сервер не шлём.
    if (next.length === value.length && next.every((c) => value.includes(c))) return;
    onChange(next);
  }

  return (
    <div className="flex flex-col" role="group" aria-label="Категория">
      {MACHINE_CATEGORIES.map((c) => (
        <label key={c} className="flex min-h-10 items-center gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={value.includes(c)}
            disabled={disabled}
            onChange={() => toggle(c)}
            data-testid={`machine-category-${c}`}
          />
          {MACHINE_CATEGORY_LABEL[c]}
        </label>
      ))}
    </div>
  );
}
