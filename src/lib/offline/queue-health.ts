// Здоровье очереди: «стоит» ли досылка (инцидент 31.07 — очередь могла молча не двигаться при живом
// интернете: инфраструктурные 5xx/обрывы не считаются к порогу конфликта ОСОЗНАННО, чтобы деплой или
// долгий офлайн не уводили действия в ложный конфликт; ценой была полная невидимость для водителя).
// Автоконфликтов по возрасту НЕ делаем — только видимый баннер с инструкцией.
import type { QueuedAction } from "./types";

/** Порог «очередь стоит»: заметно больше окна деплоя (1–2 мин) и обычной ямы связи. */
export const QUEUE_STALL_MS = 10 * 60_000;

/**
 * Сколько минут стоит очередь: возраст САМОГО СТАРОГО неконфликтного действия, если он превысил
 * порог; иначе null. Конфликтные не считаются (они ждут разбора и не досылаются by design).
 * Сравниваем по createdAt (момент постановки на этом же телефоне — часы согласованы сами с собой).
 */
export function queueStalledMinutes(actions: QueuedAction[], now: number): number | null {
  let oldest: number | null = null;
  for (const a of actions) {
    if (a.status === "conflict") continue;
    const t = Date.parse(a.createdAt);
    if (Number.isNaN(t)) continue;
    if (oldest === null || t < oldest) oldest = t;
  }
  if (oldest === null) return null;
  const age = now - oldest;
  if (age < QUEUE_STALL_MS) return null;
  return Math.floor(age / 60_000);
}
