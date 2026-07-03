import { defineConfig, devices } from "@playwright/test";

// Отдельный профиль для e2e с РЕАЛЬНЫМ service worker (O9). Запуск: `pnpm e2e:sw` — он сначала
// собирает прод-бандл с NEXT_PUBLIC_SW_CACHE=on (флаг вшивается на сборке), затем гоняет эти тесты.
// Сервер поднимает и ГАСИТ сам тест (e2e/sw/server.ts): «офлайн» эмулируем остановкой процесса —
// Playwright setOffline ненадёжен для запросов, идущих из самого SW, а мёртвый порт честно валит fetch.
// Отдельно от быстрого `pnpm e2e` (там dev-сервер, SW-кэш выключен by design).
export default defineConfig({
  testDir: "./e2e/sw",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "offline-sw", use: { ...devices["Desktop Chrome"] } }],
  // webServer НЕ задаём: сервером управляет сам тест (start/stop для эмуляции офлайна).
});
