"use client";
// Глобальный сборщик клиентских ошибок (наблюдаемость, 31.07): window.onerror + unhandledrejection →
// POST /api/client-log. Монтируется один раз в корневом layout; ничего не рендерит.
import { useEffect } from "react";
import { attachGlobalReporter } from "@/lib/report";

export function ClientErrorReporter() {
  useEffect(() => attachGlobalReporter(), []);
  return null;
}
