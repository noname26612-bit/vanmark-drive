import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // SW-профиль (e2e/sw/*) гоняется отдельной командой `pnpm e2e:sw` с прод-сборкой и собственным
  // сервером — в быстрый dev-прогон его не берём (O9).
  testIgnore: "**/sw/**",
  // Последовательный прогон (1 worker): тесты делят одну dev-БД и общий ростер водителей, а правило
  // «одна активная задача» (этап B) глобально по водителю — параллельные тесты, берущие одного
  // водителя «В работе», иначе ловят 409 ACTIVE_TASK_EXISTS друг от друга. Для масштаба проекта
  // (3 пользователя, небольшой набор) последовательный прогон надёжнее параллельных гонок.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Геокодер в e2e выключен (детерминизм, без сетевых вызовов): оценка времени = норма типа без дороги.
    env: { ...process.env, GEOCODER_PROVIDER: "none" },
  },
});
