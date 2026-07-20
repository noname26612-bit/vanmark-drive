"use client";

import { useEffect, useState } from "react";

/**
 * Значение «вдогонку»: обновляется через delayMs после последнего изменения value.
 * Для серверного поиска на «Все задачи» (SWR-ключ строится от debounced-значения, чтобы
 * не дёргать GET /api/tasks на каждый ввод). Юнит-теста нет осознанно: среда vitest — node,
 * React-рендерера в проекте нет (правило №6 — без новых зависимостей); поведение закрывает e2e.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
