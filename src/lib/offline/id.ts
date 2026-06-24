"use client";
// Идентификатор действия = Idempotency-Key (uuid v4). crypto.randomUUID доступен в защищённом
// контексте (HTTPS и localhost) — это наш случай (PWA). Один ключ на одно действие водителя:
// при досылке и повторах он не меняется, поэтому сервер применит действие ровно один раз.
export function newActionId(): string {
  return crypto.randomUUID();
}
