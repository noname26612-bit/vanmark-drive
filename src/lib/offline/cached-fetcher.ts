"use client";
// GET-фетчер для SWR водителя с офлайн-кэшем. При успехе кладёт ответ в IndexedDB (по URL);
// при отсутствии сети (ApiError status 0) отдаёт последнее сохранённое. Так список «Мои задачи»
// и карточка открываются без связи, не требуя отдельного offline-слоя внутри SWR. Доменные ошибки
// (4xx/5xx) пробрасываются как есть — это не «нет сети», кэш для них не подменяет ответ.
//
// «Наутро без связи» (O7): ключи вида /api/my/tasks?date=2026-07-01&… наутро меняются (date=07-02),
// и точный ключ в кэше пуст, хотя вчерашний ответ лежит рядом. Поэтому каждый ответ дополнительно
// сохраняется под стабильным ключом без параметра date («последний известный ответ эндпоинта»),
// и офлайн-промах точного ключа откатывается на него. UI показывает честный бейдж давности (cachedAt).
import { fetcher, ApiError } from "@/lib/fetcher";
import { idbGet, idbPut, STORE_RESPONSES } from "./db";

type Cached<T> = { data: T; cachedAt: string };

const LATEST_PREFIX = "latest:";

/**
 * Стабильный ключ URL без параметра date (чистая функция, тестируется): по нему хранится «последний
 * известный ответ» эндпоинта. null — в URL нет date, вторая запись не нужна (точного ключа достаточно).
 */
export function stableKey(url: string): string | null {
  const m = url.match(/^([^?#]*)\?([^#]*)$/);
  if (!m) return null;
  const params = new URLSearchParams(m[2]);
  if (!params.has("date")) return null;
  params.delete("date");
  const qs = params.toString();
  return LATEST_PREFIX + m[1] + (qs ? `?${qs}` : "");
}

/**
 * Чистая логика «сеть с откатом в кэш» — зависимости инжектируются, поэтому юнит-тестируется без
 * браузера/IndexedDB. Успех сети → отдать и сохранить; нет сети (ApiError 0) → отдать сохранённое
 * (если есть); доменные ошибки → пробросить, кэш не трогаем.
 */
export async function fetchWithCache<T>(
  url: string,
  net: (u: string) => Promise<T>,
  cacheGet: (u: string) => Promise<T | undefined>,
  cachePut: (u: string, data: T) => Promise<void>,
): Promise<T> {
  try {
    const data = await net(url);
    // Кэшируем best-effort: сбой записи не должен ломать загрузку при живой сети.
    void cachePut(url, data).catch(() => {});
    return data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const cached = await cacheGet(url).catch(() => undefined);
      if (cached !== undefined) return cached;
    }
    throw e;
  }
}

/** Запись из кэша с меткой времени: точный ключ, затем стабильный (для фолбэка и бейджа давности). */
export async function readCachedMeta<T>(url: string): Promise<Cached<T> | undefined> {
  try {
    const exact = await idbGet<Cached<T>>(STORE_RESPONSES, url);
    if (exact !== undefined) return exact;
    const stable = stableKey(url);
    return stable ? await idbGet<Cached<T>>(STORE_RESPONSES, stable) : undefined;
  } catch {
    return undefined;
  }
}

async function cacheGet<T>(url: string): Promise<T | undefined> {
  const c = await readCachedMeta<T>(url);
  return c?.data;
}

async function cachePut<T>(url: string, data: T): Promise<void> {
  const record = { data, cachedAt: new Date().toISOString() } satisfies Cached<T>;
  await idbPut(STORE_RESPONSES, url, record);
  const stable = stableKey(url);
  if (stable) await idbPut(STORE_RESPONSES, stable, record);
}

export function cachedFetcher<T>(url: string): Promise<T> {
  return fetchWithCache<T>(url, fetcher, cacheGet, cachePut);
}

/** Прочитать сохранённый ответ напрямую (для оверлея/префилла), не обращаясь к сети. */
export function readCached<T>(url: string): Promise<T | undefined> {
  return cacheGet<T>(url).catch(() => undefined);
}
