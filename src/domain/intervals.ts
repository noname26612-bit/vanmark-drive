// Объединение временных интервалов (20.07.2026). Нужен полосе «В работе/Простой»: у напарника
// парная задача может идти ПАРАЛЛЕЛЬНО его собственной активной — простое суммирование длительностей
// задвоило бы «отработано». Union считает каждый момент времени один раз.
// Чистый модуль без Prisma — юнит-тесты.

export type IntervalMs = { start: number; end: number };

/** Суммарная длительность объединения интервалов, мс (пересечения и смежности схлопываются). */
export function unionDurationMs(intervals: IntervalMs[]): number {
  const valid = intervals.filter((i) => i.end > i.start);
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (const iv of sorted.slice(1)) {
    if (iv.start <= curEnd) {
      curEnd = Math.max(curEnd, iv.end);
    } else {
      total += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    }
  }
  total += curEnd - curStart;
  return total;
}
