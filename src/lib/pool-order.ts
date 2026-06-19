// Чистая арифметика порядка пулов для экранов диспетчера (доска/планирование).
// Пулы адресуются стабильными ключами-строками ("undated", "upcoming", "driver:<id>", "none", <id>).
// Сохранённый порядок может отставать от реального набора (появился/удалён водитель) — поэтому
// отображаемый порядок всегда сводим к актуальному набору ключей.

/**
 * Свести сохранённый порядок к актуальному набору ключей: сначала известные ключи в сохранённом
 * порядке, затем новые (которых не было в сохранённом) — в их естественном порядке, в конец.
 * Удалённые ключи отбрасываются. Так новый водитель появляется сам, а пропавший не ломает раскладку.
 */
export function mergeOrder(saved: string[], all: string[]): string[] {
  const allSet = new Set(all);
  const ordered = saved.filter((k) => allSet.has(k));
  const seen = new Set(ordered);
  for (const k of all) {
    if (!seen.has(k)) ordered.push(k);
  }
  return ordered;
}

/**
 * Переместить пул dragKey на позицию targetKey (вставка перед target). Возвращает новый массив.
 * Если ключи равны или target отсутствует — порядок не меняется.
 */
export function moveTo(order: string[], dragKey: string, targetKey: string): string[] {
  if (dragKey === targetKey) return order;
  const without = order.filter((k) => k !== dragKey);
  const idx = without.indexOf(targetKey);
  if (idx === -1) return order;
  return [...without.slice(0, idx), dragKey, ...without.slice(idx)];
}
