"use client";
// Флаг «сессия истекла при досылке» (O8). Если очередь досылается, а сервер вернул 401/403 (JWT
// протух за 30 дней или права отозваны), досылку нельзя ни повторять вслепую, ни превращать в
// «конфликт» (действие валидное — не хватает лишь свежей сессии). Синхронизатор ставит флаг и
// останавливает прогон; UI показывает баннер «войдите заново»; первое успешное действие после
// релогина флаг снимает, и очередь досылается сама. Внешний стор для useSyncExternalStore.
let authRequired = false;
const listeners = new Set<() => void>();

export function setAuthRequired(value: boolean): void {
  if (authRequired === value) return;
  authRequired = value;
  listeners.forEach((l) => l());
}

export function getAuthRequired(): boolean {
  return authRequired;
}

export function subscribeAuthRequired(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
