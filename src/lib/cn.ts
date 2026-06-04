// Мини-помощник для склейки классов (без зависимостей).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
