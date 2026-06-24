"use client";
// Тонкая обёртка над IndexedDB для офлайн-режима водителя — без внешних зависимостей (CLAUDE.md
// правило 6). Три хранилища:
//   responses — кэш ответов GET (ключ = URL): чтобы список и карточка открывались без сети;
//   queue     — очередь исходящих действий (ключ = actionId = Idempotency-Key): досылка при связи;
//   blobs     — файлы (фото), снятые офлайн, до их отправки (ключ = blobId).
// Всё рассчитано на один телефон одного водителя и десятки записей — не на масштаб.

const DB_NAME = "vanmark-offline";
const DB_VERSION = 1;

export const STORE_RESPONSES = "responses";
export const STORE_QUEUE = "queue";
export const STORE_BLOBS = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RESPONSES)) db.createObjectStore(STORE_RESPONSES);
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE);
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
