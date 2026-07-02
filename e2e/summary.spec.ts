import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Чистый старт для правила «одна активная задача» (этап B): гасим зависшие IN_PROGRESS перед каждым тестом.
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const today = new Date().toISOString().slice(0, 10);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Создаёт задачу через UI и назначает водителю. Тип «Сдача / забор из ТК» — без обязательного фото.
async function createAssignedTask(milena: Page, driverLabel: string): Promise<string> {
  const title = `e2e-summary ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e summary");
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return id;
}

type DriverRow = { driverName: string; doneCount: number; avgOnSiteMinutes: number | null };

async function doneCountOf(milena: Page, driverName: string): Promise<number> {
  const ov = (await (await milena.request.get(`/api/summary/overview?granularity=month&date=${today}`)).json()).data;
  return (ov.drivers as DriverRow[]).find((d) => d.driverName === driverName)?.doneCount ?? 0;
}

test("сводка считает выполненную задачу и отдаёт CSV", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");

  const before = await doneCountOf(milena, "Алексей Каширский");

  // Создаём и доводим до «Выполнено» (диспетчер ведёт статусы по матрице).
  const id = await createAssignedTask(milena, "Алексей Каширский");
  for (const toStatus of ["IN_PROGRESS", "DONE"]) {
    const r = await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus } });
    expect(r.ok()).toBeTruthy();
  }

  // В месячной сводке выполнено у Каширского выросло как минимум на нашу задачу
  // (≥ before+1 — устойчиво к параллельным тестам, которые тоже могут добавлять DONE).
  const after = await doneCountOf(milena, "Алексей Каширский");
  expect(after).toBeGreaterThanOrEqual(before + 1);

  // CSV-выгрузка: вложение text/csv с заголовком и именем водителя.
  const csv = await milena.request.get(`/api/summary/export?granularity=month&date=${today}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  const text = await csv.text();
  expect(text).toContain("Водитель");
  expect(text).toContain("Алексей Каширский");

  await ctx.close();
});

test("изоляция: сводка доступна только диспетчеру/админу", async ({ browser }) => {
  // Диспетчер — доступ есть.
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  expect((await milena.request.get(`/api/summary/overview?granularity=week&date=${today}`)).status()).toBe(200);
  expect((await milena.request.get(`/api/summary/export?granularity=week&date=${today}`)).status()).toBe(200);

  // Водитель — обе ручки закрыты (403, не данные по коллегам).
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await driver.request.get(`/api/summary/overview?granularity=week&date=${today}`)).status()).toBe(403);
  expect((await driver.request.get(`/api/summary/export?granularity=week&date=${today}`)).status()).toBe(403);

  // Гость без сессии → 401.
  const gctx = await browser.newContext();
  const g = await gctx.newPage();
  expect((await g.request.get(`/api/summary/overview?granularity=week&date=${today}`)).status()).toBe(401);
  expect((await g.request.get(`/api/summary/export?granularity=week&date=${today}`)).status()).toBe(401);

  await mctx.close();
  await dctx.close();
  await gctx.close();
});
