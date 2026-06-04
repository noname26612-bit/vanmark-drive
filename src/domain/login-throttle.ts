// Защита входа от перебора пароля (CLAUDE.md правило, ARCHITECTURE §6).
// Без внешних сервисов: для 3 пользователей и одного инстанса достаточно счётчика в памяти
// процесса (см. CLAUDE.md «не переусложнять»). Сбрасывается при рестарте — это приемлемо.
//
// Ключ — нормализованный логин, НЕ IP: иначе офис за общим NAT блокировался бы целиком.
// Компромисс: атакующий с разных IP может намеренно «залочить» чужую учётку (DoS). Для
// внутреннего инструмента на 3 человека риск приемлемый; при росту — вынести в БД/Redis.
//
// Логика разнесена на чистые функции (evaluate/registerFailure) — их и покрываем unit-тестами;
// стор (Map) — тонкая обёртка над ними.

export const MAX_FAILURES = 10; // после 10 неудач подряд — блокировка
export const FAILURE_WINDOW_MS = 15 * 60_000; // окно накопления неудач — 15 мин
export const LOCKOUT_MS = 15 * 60_000; // длительность блокировки — 15 мин

export type ThrottleEntry = {
  failures: number[]; // отметки времени недавних неудачных попыток (мс)
  lockedUntil: number | null; // если задано и в будущем — вход заблокирован
};

export type LockState = { locked: false } | { locked: true; retryAfterMs: number };

export function emptyEntry(): ThrottleEntry {
  return { failures: [], lockedUntil: null };
}

/** Чистая проверка: заблокирован ли ключ в момент `now`. */
export function evaluate(entry: ThrottleEntry, now: number): LockState {
  if (entry.lockedUntil !== null && entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }
  return { locked: false };
}

/**
 * Чистая регистрация неудачной попытки: если прошлая блокировка истекла — счёт начинается
 * заново; протухшие (вне окна) отметки отбрасываются; при достижении порога выставляется
 * `lockedUntil`. Возвращает НОВОЕ состояние (исходное не мутируется).
 */
export function registerFailure(entry: ThrottleEntry, now: number): ThrottleEntry {
  const base = entry.lockedUntil !== null && entry.lockedUntil <= now ? emptyEntry() : entry;
  const recent = base.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
  recent.push(now);
  const lockedUntil = recent.length >= MAX_FAILURES ? now + LOCKOUT_MS : base.lockedUntil;
  return { failures: recent, lockedUntil };
}

// --- Стор в памяти процесса -------------------------------------------------

const store = new Map<string, ThrottleEntry>();

function keyFor(login: string): string {
  return login.trim().toLowerCase();
}

/** Заблокирован ли вход для логина. */
export function checkLock(login: string, now: number = Date.now()): LockState {
  const entry = store.get(keyFor(login));
  return entry ? evaluate(entry, now) : { locked: false };
}

/** Зафиксировать неудачную попытку входа. Возвращает актуальное состояние блокировки. */
export function recordFailure(login: string, now: number = Date.now()): LockState {
  const key = keyFor(login);
  const next = registerFailure(store.get(key) ?? emptyEntry(), now);
  store.set(key, next);
  return evaluate(next, now);
}

/** Успешный вход — снимаем счётчик. */
export function recordSuccess(login: string): void {
  store.delete(keyFor(login));
}

/** Только для тестов: очистить стор между кейсами. */
export function __resetThrottle(): void {
  store.clear();
}
