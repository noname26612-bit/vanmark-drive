"use client";

// Категорий у станка может быть несколько (решение Артёма 20.08.2026: «наш на продажу может быть и
// арендным»). Выпадашка такое не выражает — здесь строки с галочками, по одной на категорию.
//
// Правила совместимости живут в домене (isValidCategorySet): набор не бывает пустым, а «Клиентский»
// ни с чем не совмещается. Компонент их не проверяет ПОСЛЕ выбора, а не даёт собрать недопустимый
// набор: клик по клиентской снимает наши, клик по нашей снимает клиентскую, последнюю галочку снять
// нельзя. Иначе человек упирается в отказ сервера там, где ошибка видна заранее.
import { MACHINE_CATEGORIES, normalizeCategories } from "@/domain/machine-status";
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
    if (value.includes(category)) {
      // Пустой набор сервер отвергнет — единственную галочку просто не снимаем.
      if (value.length === 1) return;
      onChange(normalizeCategories(value.filter((c) => c !== category)));
      return;
    }
    // «Клиентский» эксклюзивен в обе стороны: включили его — наши уходят, включили нашу — уходит он.
    const next: MachineCategory[] =
      category === "CLIENT" ? [category] : [...value.filter((c) => c !== "CLIENT"), category];
    onChange(normalizeCategories(next));
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
