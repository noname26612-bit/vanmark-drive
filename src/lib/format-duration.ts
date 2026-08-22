// Длительность в минутах человеческим текстом — одна правда для доски, Сводки, KPI и истории смен.
// До 22.08.2026 таких функций в проекте было три (formatOnSite в Сводке, formatDuration в истории
// смен, fmtDur на доске) с чуть разными краями: «2 ч 0 мин» против «2 ч», «—» против «0 мин».
// Разные подписи одного и того же числа на соседних экранах читаются как разные величины.
import { formatMinutes } from "@/domain/capacity";

/**
 * «1 ч 12 мин» / «34 мин» / «2 ч». `null`/`undefined` — «—» (нет данных ≠ ноль: смен не было,
 * среднее не из чего считать).
 */
export function formatDuration(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  return formatMinutes(min);
}
