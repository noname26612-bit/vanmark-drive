"use client";
// GET-фетчер для SWR водителя с офлайн-кэшем. При успехе кладёт ответ в IndexedDB (по URL);
// при отсутствии сети (ApiError status 0) отдаёт последнее сохранённое. Так список «Мои задачи»
// и карточка открываются без связи, не требуя отдельного offline-слоя внутри SWR. Доменные ошибки
// (4xx/5xx) пробрасываются как есть — это не «нет сети», кэш для них не подменяет ответ.
import { fetcher, ApiError } from "@/lib/fetcher";
import { idbGet, idbPut, STORE_RESPONSES } from "./db";

type Cached<T> = { data: T; cachedAt: string };

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

async function cacheGet<T>(url: string): Promise<T | undefined> {
  const c = await idbGet<Cached<T>>(STORE_RESPONSES, url);
  return c?.data;
}

async function cachePut<T>(url: string, data: T): Promise<void> {
  await idbPut(STORE_RESPONSES, url, { data, cachedAt: new Date().toISOString() } satisfies Cached<T>);
}

export function cachedFetcher<T>(url: string): Promise<T> {
  return fetchWithCache<T>(url, fetcher, cacheGet, cachePut);
}

/** Прочитать сохранённый ответ напрямую (для оверлея/префилла), не обращаясь к сети. */
export function readCached<T>(url: string): Promise<T | undefined> {
  return cacheGet<T>(url).catch(() => undefined);
}
