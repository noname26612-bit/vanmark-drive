// Чистая логика настроек интерфейса пользователя (раскладка экранов диспетчера): белый список
// ключей, типы, санитизация значений. БЕЗ доступа к БД — тестируется напрямую (как src/domain/kpi.ts).
// Доступ к хранилищу — в src/domain/ui-prefs-service.ts.

// Допустимые настройки. board.* — доска «Сегодня», planning.* — «Планирование».
export const UI_PREF_KEYS = ["board.order", "board.collapsed", "planning.order"] as const;
export type UiPrefKey = (typeof UI_PREF_KEYS)[number];

export type UiPrefs = Record<UiPrefKey, string[]>;

const MAX_ITEMS = 100; // пулов/строк заведомо меньше; запас от раздувания
const MAX_LEN = 100; // ключ пула вида "driver:<uuid>" короче

export function isUiPrefKey(key: string): key is UiPrefKey {
  return (UI_PREF_KEYS as readonly string[]).includes(key);
}

/** Привести произвольное значение к массиву валидных строк-ключей (санитизация входа/хранилища). */
export function sanitizeKeyArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    if (v.length === 0 || v.length > MAX_LEN) continue;
    if (seen.has(v)) continue; // без дублей
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** Пустые настройки (дефолт, когда у пользователя ещё ничего не сохранено). */
export function emptyUiPrefs(): UiPrefs {
  return { "board.order": [], "board.collapsed": [], "planning.order": [] };
}
