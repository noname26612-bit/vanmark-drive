// Приём клиентских ошибок (наблюдаемость, 31.07): телефоны водителей — «чёрный ящик», инциденты
// («висит на логотипе», «кнопка молчит») было невозможно разобрать без устройства в руках. Клиент
// шлёт ошибку сюда, мы печатаем одну JSON-строку в stdout (docker logs) — БЕЗ записи в БД
// (не переусложнять: 3 пользователя; ротацию делает logging-секция compose).
//
// Чистые функции (клэмп + rate-limit) отделены от стора — их покрываем unit-тестами.

export const MSG_MAX = 500;
export const STACK_MAX = 4000;
export const CONTEXT_MAX = 200;
export const URL_MAX = 300;
export const BODY_MAX = 8 * 1024; // сырое тело; больше — не читаем вовсе

export const RATE_WINDOW_MS = 5 * 60_000;
export const RATE_MAX = 30; // записей на один ключ (пользователь/аноним) в окно

export type ClientLogEntry = {
  msg: string;
  stack?: string;
  context?: string;
  url?: string;
};

/** Нормализация и клэмп полей произвольного (недоверенного) тела. null — тело непригодно. */
export function sanitizeClientLog(body: Record<string, unknown>): ClientLogEntry | null {
  const msg = typeof body.msg === "string" ? body.msg.trim().slice(0, MSG_MAX) : "";
  if (!msg) return null;
  const entry: ClientLogEntry = { msg };
  if (typeof body.stack === "string" && body.stack.trim()) entry.stack = body.stack.slice(0, STACK_MAX);
  if (typeof body.context === "string" && body.context.trim()) entry.context = body.context.slice(0, CONTEXT_MAX);
  if (typeof body.url === "string" && body.url.trim()) entry.url = body.url.slice(0, URL_MAX);
  return entry;
}

export type RateEntry = { stamps: number[] };

/** Чистый слайдинг-лимитер: true → писать можно, состояние обновлено. */
export function rateAllow(entry: RateEntry, now: number): { allowed: boolean; entry: RateEntry } {
  const recent = entry.stamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return { allowed: false, entry: { stamps: recent } };
  recent.push(now);
  return { allowed: true, entry: { stamps: recent } };
}

// --- Стор лимитера в памяти процесса (как login-throttle) --------------------

const store = new Map<string, RateEntry>();

export function checkRate(key: string, now: number = Date.now()): boolean {
  const { allowed, entry } = rateAllow(store.get(key) ?? { stamps: [] }, now);
  store.set(key, entry);
  // Потолок ключей — чтобы аноним не раздул Map бесконечными ключами (у нас ключ = login или "anon",
  // так что это чистая перестраховка).
  if (store.size > 1000) store.clear();
  return allowed;
}

/** Только для тестов. */
export function __resetClientLogRate(): void {
  store.clear();
}
