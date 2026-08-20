"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  configurationOptionsFor,
  joinConfiguration,
  splitConfiguration,
} from "@/lib/machine-configuration";
import type { EquipmentKind } from "@/generated/prisma/enums";

/**
 * Комплектация станка галочками (решение Артёма 20.08.2026: «нужно сделать вывод строк и сбоку
 * галочки… и возможность добавить свой вариант»).
 *
 * В БД это по-прежнему ОДНА строка Machine.configuration, поэтому галочки — чистая ПРОИЗВОДНАЯ от
 * значения, а не второе состояние: иначе черновик формы и галочки неизбежно разъехались бы.
 *
 * Компонент общий для формы заведения и формы правки карточки: у Максима на площадке уже 30–40
 * карточек, заведённых свободным текстом, и если бы правка осталась строкой, разнобой написаний
 * («роликовый нож» / «Роликовый нож») никуда бы не делся — а галочки затевались ровно ради него.
 *
 * У видов без своего набора (нож, фальц машинка, складские остатки) это обычное текстовое поле.
 */
export function ConfigurationField({
  kind,
  value,
  onChange,
  label = "Комплектация",
  testId = "machine-configuration",
}: {
  kind: EquipmentKind;
  value: string;
  onChange: (next: string) => void;
  label?: string;
  testId?: string;
}) {
  // Хвост «своего варианта» держим ещё и локально: joinConfiguration обрезает пробелы по краям, и
  // без этого эха пробел между словами исчезал бы прямо под пальцами («нож с приводом» → «ножс»).
  // Эхо действует, только пока даёт ровно ту же строку, что уже лежит в значении; во всех остальных
  // случаях (черновик, смена вида, чужая правка) выигрывает разобранное значение — правда одна.
  const [customEcho, setCustomEcho] = useState("");

  const options = configurationOptionsFor(kind);
  const parts = splitConfiguration(kind, value);
  const custom =
    joinConfiguration(kind, parts.selected, customEcho) === value ? customEcho : parts.custom;

  function write(selected: readonly string[], nextCustom: string) {
    setCustomEcho(nextCustom);
    onChange(joinConfiguration(kind, selected, nextCustom));
  }

  if (options.length === 0) {
    return (
      <Field label={label}>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="нож, машинка, стойка…"
          data-testid={`${testId}-text`}
        />
      </Field>
    );
  }

  return (
    <div data-testid={testId}>
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <div className="mt-1 flex flex-col">
        {options.map((option, i) => (
          <label key={option} className="flex min-h-10 items-center gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={parts.selected.includes(option)}
              onChange={() =>
                write(
                  parts.selected.includes(option)
                    ? parts.selected.filter((o) => o !== option)
                    : [...parts.selected, option],
                  custom,
                )
              }
              data-testid={`${testId === "machine-configuration" ? "machine-config" : testId}-${i}`}
            />
            {option}
          </label>
        ))}
      </div>
      <Field label="Свой вариант">
        <Input
          value={custom}
          onChange={(e) => write(parts.selected, e.target.value)}
          placeholder="нож, машинка, стойка…"
          data-testid={`${testId === "machine-configuration" ? "machine-config" : testId}-custom`}
        />
      </Field>
    </div>
  );
}
