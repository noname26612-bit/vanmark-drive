import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("диспетчер: создание → назначение → перенос → отмена, история пишется", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  await page.goto("/tasks");

  await page.getByRole("button", { name: "Задача" }).click();

  // доступны все 11 типов (10 рабочих + «Прочее»)
  await expect(page.locator('[data-testid="create-type"] option')).toHaveCount(11);

  const title = `E2E задача ${Date.now()}`;
  await page.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await page.getByPlaceholder("Москва, ул. ..., д. ...").fill("Тестовый адрес 1");
  await page.getByRole("button", { name: "Создать", exact: true }).click();

  // появилась в таблице, открываем карточку
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: /№\d+/ })).toBeVisible();

  // назначение исполнителя → статус «Назначена»
  await page.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Писарев" });
  await expect(page.getByText("Назначена").first()).toBeVisible();

  // перенос на новую дату → событие «Перенос» в истории
  await page.getByRole("button", { name: "Перенести" }).click();
  const reDialog = page.getByRole("dialog");
  await reDialog.locator('input[type="date"]').fill("2026-06-20");
  await reDialog.getByRole("button", { name: "Перенести" }).click();
  await expect(page.getByText("Перенос")).toBeVisible();

  // отмена с причиной → статус «Отменена»
  await page.getByRole("button", { name: "Отменить" }).click();
  const cancelDialog = page.getByRole("dialog");
  await cancelDialog.getByPlaceholder("Почему отменяем").fill("Клиент отказался — тест");
  await cancelDialog.getByRole("button", { name: "Отменить задачу" }).click();
  await expect(page.getByText("Отменена").first()).toBeVisible();
});

test("изоляция: водитель не видит список, чужую задачу и не создаёт (API)", async ({ browser }) => {
  // Диспетчер создаёт задачу и узнаёт её id
  const mctx = await browser.newContext();
  const mpage = await mctx.newPage();
  await login(mpage, "milena");
  await mpage.goto("/tasks");
  await mpage.getByRole("button", { name: "Задача" }).click();
  const title = `iso ${Date.now()}`;
  await mpage.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await mpage.getByPlaceholder("Москва, ул. ..., д. ...").fill("iso addr");
  await mpage.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(mpage.getByRole("link", { name: title })).toBeVisible();

  const listRes = await mpage.request.get(`/api/tasks?q=${encodeURIComponent(title)}`);
  const list = await listRes.json();
  const taskId: string = list.data[0].id;

  // Водитель в отдельном контексте
  const dctx = await browser.newContext();
  const dpage = await dctx.newPage();
  await login(dpage, "kashirskiy");

  expect((await dpage.request.get("/api/tasks")).status()).toBe(403); // не диспетчер
  expect((await dpage.request.get(`/api/tasks/${taskId}`)).status()).toBe(404); // чужая → 404
  const created = await dpage.request.post("/api/tasks", {
    data: { typeId: "whatever", title: "x", address: "y" },
  });
  expect(created.status()).toBe(403); // водитель не создаёт

  await mctx.close();
  await dctx.close();
});
