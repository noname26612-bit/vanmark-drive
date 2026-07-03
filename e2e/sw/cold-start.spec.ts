import { test, expect, type Page } from "@playwright/test";
import { startServer, stopServer } from "./server";
import { resetActiveTasks } from "../reset";

// Холодный старт без сети через РЕАЛЬНЫЙ service worker (O9). Впервые автоматизирует то, что раньше
// проверялось только руками на проде: приложение открывается с иконки без связи (оболочка из Cache API,
// список из IndexedDB). «Офлайн» = остановленный сервер (см. server.ts). Прод-бандл с включённым
// SW-кэшем собирает `pnpm e2e:sw`.
test.beforeAll(startServer);
test.afterAll(stopServer);
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("холодный старт без сети: оболочка из кэша + список из IndexedDB", async ({ page }) => {
  test.slow();
  await login(page, "pisarev");
  await page.goto("/m");
  await expect(page.getByText(/Смена|Открыть смену|Сегодня/).first()).toBeVisible();

  // SW встал и управляет страницей.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });

  // Оболочка /m попала в Cache API (precache/warm-shell/networkFirst). Ждём появления.
  await page.waitForFunction(
    async () => {
      for (const k of await caches.keys()) {
        const c = await caches.open(k);
        if (await c.match("/m")) return true;
      }
      return false;
    },
    null,
    { timeout: 20_000 },
  );

  // Гасим сервер — эмуляция полного отсутствия сети (падает и fetch из SW).
  await stopServer();

  // Перезагрузка «с иконки»: навигацию обслуживает SW из кэша, список — cachedFetcher из IndexedDB.
  await page.reload();
  await expect(page.getByText(/Смена|Открыть смену|Сегодня/).first()).toBeVisible({ timeout: 20_000 });
  // Никакого экрана логина (главная ловушка O9: под /m не должен лежать HTML логина).
  expect(new URL(page.url()).pathname).not.toContain("/login");
  await expect(page.getByRole("textbox", { name: /логин/i })).toHaveCount(0);

  // Возвращаем сервер для следующих тестов/afterAll.
  await startServer();
});

test("логин-ловушка: страница входа не подменяется закэшированной оболочкой", async ({ page }) => {
  test.slow();
  // Заходим на /login при живом сервере, чтобы SW «увидел» навигацию на логин.
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /войти|вход/i }).first()).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });

  await stopServer();
  // Офлайн-логин невозможен, но и оболочку /m вместо формы отдавать нельзя — /login network-only.
  const resp = await page.goto("/login").catch(() => null);
  // Либо честная ошибка сети (сервер мёртв), либо форма — но НЕ закэшированная оболочка «Мои задачи».
  if (resp) {
    await expect(page.getByText("Мои задачи")).toHaveCount(0);
  }
  await startServer();
});
