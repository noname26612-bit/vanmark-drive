import { test, expect, type Page } from "@playwright/test";

// Ёмкость и оценка времени (Фаза 2, PRD §14). Геокодер в e2e выключен (playwright.config:
// GEOCODER_PROVIDER=none) → оценка времени = норма типа без дороги (детерминированно).
// Проверяем: изоляция админ-ручек настроек; авто-оценка при создании, ручная правка и пересчёт.

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createRepairTask(milena: Page): Promise<string> {
  const title = `e2e cap ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Выездной ремонт / диагностика" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e ёмкости");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  return milena.url().split("/tasks/")[1];
}

test("настройки ёмкости: только админ; диспетчер/водитель/гость — отказ", async ({ browser }) => {
  test.slow();
  // админ — читает настройки и список водителей
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");
  const okRes = await artem.request.get("/api/admin/capacity-settings");
  expect(okRes.status()).toBe(200);
  const body = (await okRes.json()).data;
  expect(typeof body.settings.avgSpeedKmh).toBe("number");
  expect(Array.isArray(body.drivers)).toBe(true);
  expect(body.drivers.length).toBeGreaterThanOrEqual(2);

  // диспетчер — НЕ админ → 403 на чтение и запись
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  expect((await milena.request.get("/api/admin/capacity-settings")).status()).toBe(403);
  expect((await milena.request.put("/api/admin/traffic-windows", { data: { windows: [] } })).status()).toBe(403);

  // водитель → 403
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await driver.request.get("/api/admin/capacity-settings")).status()).toBe(403);

  // гость (без входа) → 401
  const gctx = await browser.newContext();
  expect((await gctx.request.get("/api/admin/capacity-settings")).status()).toBe(401);

  await actx.close();
  await mctx.close();
  await dctx.close();
  await gctx.close();
});

test("оценка времени: авто при создании, ручная правка и пересчёт", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const taskId = await createRepairTask(milena);

  const section = milena.getByTestId("estimate-section");
  const total = milena.getByTestId("estimate-total");

  // Авто-оценка = норма «Выездной ремонт / диагностика» (90 мин), геокодер выключен → без дороги.
  await expect(total).toContainText("1 ч 30 мин");
  await expect(section.getByText("авто", { exact: true })).toBeVisible();

  // Ручная правка: 200 мин → «3 ч 20 мин», бейдж «вручную».
  await milena.getByTestId("estimate-input").fill("200");
  await milena.getByTestId("estimate-save").click();
  await expect(total).toContainText("3 ч 20 мин");
  await expect(section.getByText("вручную", { exact: true })).toBeVisible();

  // Пересчёт → обратно к авто (90 мин), бейдж «авто».
  await milena.getByTestId("estimate-recompute").click();
  await expect(total).toContainText("1 ч 30 мин");
  await expect(section.getByText("авто", { exact: true })).toBeVisible();

  // Изоляция API: водитель не может править поля чужой задачи (PATCH) → 404.
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  const res = await driver.request.patch(`/api/tasks/${taskId}`, { data: { estimatedMinutes: 5 } });
  expect([403, 404]).toContain(res.status());

  await mctx.close();
  await dctx.close();
});
