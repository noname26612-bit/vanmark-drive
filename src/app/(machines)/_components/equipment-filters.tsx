"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { GROUP_OPTIONS, type EquipmentView } from "@/lib/equipment-view";

/**
 * Фильтры и вид списка оборудования — сбоку, строками с галочкой (решение Артёма 20.08.2026:
 * «фильтр по группам нужно сделать строками и сбоку чтобы галочкой можно было выбрать… и на
 * будущее: мне очень не нравятся выпадающие списки»).
 *
 * Поэтому здесь НЕТ ни одного <select>: каждая настройка — это столбик строк, из которых выбрана
 * ровно одна (поведение радио, отсюда role="radio"/aria-checked). Фильтр по состоянию убран
 * совсем — состояния и так переключаются счётчиками над списком, и вторая точка входа в тот же
 * фильтр только путала.
 *
 * За компьютером секции стоят в боковой колонке всегда, на телефоне — прячутся под одну шапку:
 * четыре экрана переключателей до начала списка на 360px никто листать не станет.
 */
export function EquipmentFilters({
  view,
  onView,
  scope,
  onScope,
  filtersOn,
  onReset,
}: {
  view: EquipmentView;
  onView: (next: EquipmentView) => void;
  scope: "active" | "archive";
  onScope: (next: "active" | "archive") => void;
  filtersOn: boolean;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);

  const sections = (
    <FilterSections
      view={view}
      onView={onView}
      scope={scope}
      onScope={onScope}
      filtersOn={filtersOn}
      onReset={onReset}
    />
  );

  // Свёрнутая шапка показывает текущий выбор словами — иначе непонятно, почему список разложен так.
  const groupLabel = GROUP_OPTIONS.find((o) => o.key === view.groupBy)?.label ?? "Без групп";
  const scopeLabel = scope === "archive" ? "Архив" : "На площадке";

  return (
    <>
      <div className="hidden rounded-lg border border-neutral-200 bg-white p-2 lg:block">
        {sections}
      </div>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="machine-filters-toggle"
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800"
        >
          <span className="shrink-0 font-medium">Фильтры и вид</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
            <span className="truncate">
              {groupLabel} · {scopeLabel}
            </span>
            {open ? (
              <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
            )}
          </span>
        </button>
        {open ? (
          <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-2">{sections}</div>
        ) : null}
      </div>
    </>
  );
}

/** Одна и та же колонка секций для обеих раскладок — второй копии разметки быть не должно. */
function FilterSections({
  view,
  onView,
  scope,
  onScope,
  filtersOn,
  onReset,
}: {
  view: EquipmentView;
  onView: (next: EquipmentView) => void;
  scope: "active" | "archive";
  onScope: (next: "active" | "archive") => void;
  filtersOn: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Section title="Показ">
        <FilterRow
          label="На площадке"
          active={scope === "active"}
          onClick={() => onScope("active")}
          testId="machine-scope-active"
        />
        <FilterRow
          label="Архив"
          active={scope === "archive"}
          onClick={() => onScope("archive")}
          testId="machine-scope-archive"
        />
      </Section>

      <Section title="Группировка">
        {GROUP_OPTIONS.map((o) => (
          <FilterRow
            key={o.key}
            label={o.label}
            active={view.groupBy === o.key}
            onClick={() => onView({ ...view, groupBy: o.key })}
            testId={`machine-group-${o.key}`}
          />
        ))}
      </Section>

      <Section title="Порядок">
        <FilterRow
          label="Сначала маленькие номера"
          active={view.direction === "asc"}
          onClick={() => onView({ ...view, direction: "asc" })}
          testId="machine-direction-asc"
        />
        <FilterRow
          label="Сначала большие"
          active={view.direction === "desc"}
          onClick={() => onView({ ...view, direction: "desc" })}
          testId="machine-direction-desc"
        />
      </Section>

      {filtersOn ? (
        <Button
          variant="secondary"
          onClick={onReset}
          className="w-full"
          data-testid="machine-filters-reset"
        >
          Сбросить фильтры
        </Button>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 px-2.5 text-xs font-medium text-neutral-500">{title}</h3>
      <div role="radiogroup" aria-label={title} className="flex flex-col">
        {children}
      </div>
    </div>
  );
}

/**
 * Строка-переключатель во всю ширину: текст слева, галочка у выбранного. Выбор подкреплён ещё и
 * графитовой подсветкой — по одной иконке в столбце из восьми строк глаз выбранное не находит.
 * Цвета нейтральные: это настройка показа, а не состояние, требующее действия (ui-guidelines).
 */
function FilterRow({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-neutral-100 font-medium text-neutral-900"
          : "text-neutral-600 hover:bg-neutral-50",
      )}
    >
      <span className="min-w-0">{label}</span>
      {active ? <Check className="h-4 w-4 shrink-0 text-neutral-900" aria-hidden /> : null}
    </button>
  );
}
