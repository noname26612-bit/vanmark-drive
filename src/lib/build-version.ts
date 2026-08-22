import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Версия текущей сборки — та же строка, что стоит в имени кэша service worker.
 *
 * Зачем на экране «Управление»: при разборе жалобы «у водителя старая версия» первый вопрос — какая
 * версия сейчас на сервере. До сих пор её приходилось смотреть на сервере в `public/sw-version.js`
 * (инцидент build-skew 07.07.2026 начинался именно с этого вопроса).
 *
 * Файл появляется на шаге `prebuild` (scripts/stamp-sw-version.mjs) и в репозиторий не коммитится:
 * в dev его может не быть вовсе — тогда честно отвечаем «dev», а не выдумываем номер.
 */
let cached: string | null = null;

export function buildVersion(): string {
  if (cached !== null) return cached;
  try {
    const raw = readFileSync(join(process.cwd(), "public", "sw-version.js"), "utf8");
    const m = /SW_VERSION\s*=\s*"([^"]+)"/.exec(raw);
    cached = m ? m[1] : "dev";
  } catch {
    cached = "dev"; // файла нет — это локальная разработка (pnpm dev без build)
  }
  return cached;
}
