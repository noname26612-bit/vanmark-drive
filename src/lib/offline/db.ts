"use client";
// Тонкая обёртка над IndexedDB для офлайн-режима водителя — без внешних зависимостей (CLAUDE.md
// правило 6). Три хранилища:
//   responses — кэш ответов GET (ключ = URL): чтобы список и карточка открывались без сети;
//   queue     — очередь исходящих действий (ключ = actionId = Idempotency-Key): досылка при связи;
//   blobs     — файлы (фото), снятые офлайн, до их отправки (ключ = blobId).
// Всё рассчитано на один телефон одного водителя и десятки записей — не на масштаб.

const DB_NAME = "vanmark-offline";

export const STORE_RESPONSES = "responses";
export const STORE_QUEUE = "queue";
export const STORE_BLOBS = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

const ALL_STORES = [STORE_RESPONSES, STORE_QUEUE, STORE_BLOBS];

function rawOpen(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ALL_STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    // onblocked: апгрейд заблокирован другой открытой вкладкой/SW — раньше промис висел вечно
    // (инцидент 31.07: «мёртвая» очередь без единого симптома). Отказ → ретрай при следующем вызове.
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Открытие с самолечением. Всегда открываем БЕЗ версии (берётся текущая; у свежей установки будет
// v1 с созданием сторов) — жёсткая версия в коде дала бы VersionError после любого доращивания.
// SW-sync мог успеть создать БД БЕЗ сторов (старый public/sw.js открывал её без версии; sync-событие
// до первого запуска приложения «отравляло» БД — onupgradeneeded на той же версии больше не
// срабатывал, и все операции молча падали). Недостающие сторы доращиваем версионным открытием —
// данные существующих сторов не трогаются.
async function openWithRepair(): Promise<IDBDatabase> {
  const db = await rawOpen();
  if (ALL_STORES.every((s) => db.objectStoreNames.contains(s))) return db;
  const v = db.version + 1;
  db.close();
  return rawOpen(v);
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openWithRepair();
  // Отказ открытия (private mode, блокировка, повреждение) не кэшируем навсегда — раньше одна
  // неудача убивала офлайн-слой на всю сессию; следующий вызов попробует открыть заново.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbPut(store: string, key: string, value: unknown): Promise<IDBValidKey> {
  return run<IDBValidKey>(store, "readwrite", (s) => s.put(value, key));
}

export function idbDelete(store: string, key: string): Promise<undefined> {
  return run<undefined>(store, "readwrite", (s) => s.delete(key) as IDBRequest<undefined>);
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}
