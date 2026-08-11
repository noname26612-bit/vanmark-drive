"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { parseTimeInput, isCompleteTime } from "@/lib/time-input";

// Поле ввода времени. С 11.08.2026 — обычное текстовое поле с умным разбором вместо нативного
// `input[type=time]` (решение Артёма: «не получается нормально указывать время»).
//
// Почему ушли от нативного: в Safari он рисует сегменты «07:30 PM» плюс иконку часов, попасть
// курсором по часам и минутам практически невозможно — поймано ещё 03.08 на закрытии смены, тогда
// вылечили только ширину поля. Текстовый ввод снимает проблему целиком: печатаешь «1630» —
// получаешь 16:30. Понимает «16:30», «16.30», «16 30», «930», «9», «сейчас» (см. lib/time-input).
//
// Коммит значения — сразу, как только набранное распознано (а не только по Enter/уходу, как в
// DateField). Это важно и людям (живой расчёт «Смена получится 10 ч 11 мин» пересчитывается по
// ходу ввода), и тестам: e2e закрытия смены заполняют поле через fill() без Enter.
//
// Ширина и shrink-0 сохранены с прежней версии: в ряду с растягивающимся полем причины поле без
// собственной ширины схлопывается.
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
  const [text, setText] = useState(value);

  // Внешнее изменение value (сброс формы, подстановка времени) → синхронизируем поле без useEffect
  // (паттерн React «adjust state on prop change»), как это сделано в DateField.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }

  function handleChange(next: string) {
    setText(next);
    // Полностью валидное «ЧЧ:ММ» отдаём сразу; «1630» тоже распознаётся на лету, но текст в поле
    // не переписываем — иначе курсор прыгает посреди набора. Нормализация — на Enter/уходе.
    const parsed = parseTimeInput(next);
    if (parsed && (isCompleteTime(next) || next.replace(/\D/g, "").length === 4)) onChange(parsed);
    else if (next.trim() === "") onChange("");
  }

  function commit() {
    const raw = text.trim();
    if (raw === "") {
      if (value !== "") onChange("");
      return;
    }
    const parsed = parseTimeInput(raw, nowHHMM());
    if (parsed) {
      setText(parsed);
      if (parsed !== value) onChange(parsed);
    } else {
      setText(value); // не распознали — откатываем к прежнему, чтобы не сохранить мусор
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="чч:мм"
      data-testid={testId}
      value={text}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className={cn(
        "h-10 w-[132px] shrink-0 rounded-lg border border-neutral-300 px-2 text-sm tabular-nums",
        "focus:border-neutral-900 focus:outline-none disabled:opacity-50",
        className,
      )}
    />
  );
}

function nowHHMM(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
