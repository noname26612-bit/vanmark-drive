import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Создаёт задачу нужного типа и назначает на водителя через UI; возвращает id.
async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<string> {
  const title = `e2e ws ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e");
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

test("ведомость: водитель заполняет и отправляет на расценку; чужой не может; после отправки заблокировано", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");

  // выездной ремонт требует расценку → ведомость заведена в DRAFT
  let detail = await (await milena.request.get(`/api/tasks/${id}`)).json();
  expect(detail.data.type.requiresPricing).toBe(true);
  expect(detail.data.worksheetStatus).toBe("DRAFT");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // справочник работ доступен водителю
  const cat = await (await driver.request.get("/api/work-catalog")).json();
  expect(cat.data.length).toBeGreaterThan(0);
  const firstWork: string = cat.data[0].id;

  // позиция из справочника + свободная строка
  const add1 = await driver.request.post(`/api/tasks/${id}/work-items`, {
    data: { catalogItemId: firstWork, quantity: 2 },
  });
  expect(add1.status()).toBe(201);
  const add2 = await driver.request.post(`/api/tasks/${id}/work-items`, {
    data: { name: "Дополнительная работа", quantity: 1 },
  });
  expect(add2.status()).toBe(201);

  detail = await (await milena.request.get(`/api/tasks/${id}`)).json();
  expect(detail.data.workItems.length).toBe(2);

  // чужой водитель (Писарев) не может добавить позицию в задачу Каширского → 404 (изоляция)
  const bctx = await browser.newContext();
  const b = await bctx.newPage();
  await login(b, "pisarev");
  const foreign = await b.request.post(`/api/tasks/${id}/work-items`, { data: { name: "взлом", quantity: 1 } });
  expect(foreign.status()).toBe(404);

  // отправка на расценку → PRICING
  const submit = await driver.request.post(`/api/tasks/${id}/worksheet/submit`);
  expect(submit.status()).toBe(200);
  detail = await (await milena.request.get(`/api/tasks/${id}`)).json();
  expect(detail.data.worksheetStatus).toBe("PRICING");

  // после отправки правка ведомости заблокирована → 409 WORKSHEET_LOCKED
  const locked = await driver.request.post(`/api/tasks/${id}/work-items`, { data: { name: "поздно", quantity: 1 } });
  expect(locked.status()).toBe(409);
  expect((await locked.json()).error.code).toBe("WORKSHEET_LOCKED");

  await mctx.close();
  await dctx.close();
  await bctx.close();
});

test("ведомость не заводится для типа без расценки", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Сдача / забор из ТК");

  const detail = await (await milena.request.get(`/api/tasks/${id}`)).json();
  expect(detail.data.type.requiresPricing).toBe(false);
  expect(detail.data.worksheetStatus).toBeNull();

  // добавить позицию в задачу без расценки нельзя
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  const add = await driver.request.post(`/api/tasks/${id}/work-items`, { data: { name: "x", quantity: 1 } });
  expect(add.status()).toBe(422);

  await mctx.close();
  await dctx.close();
});

test("ведомость на телефоне (360×740): водитель добавляет работу и отправляет через UI", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  await driver.goto(`/m/${id}`);

  // блок ведомости виден для типа с расценкой
  await expect(driver.getByText("Ведомость работ")).toBeVisible();
  // выбрать работу из справочника (index 1 — первая работа после «Своя работа…») и добавить
  await driver.locator('[data-testid="worksheet-select"]').selectOption({ index: 1 });
  await driver.getByRole("button", { name: "Добавить" }).click();
  await expect(driver.getByText(/· \d+ шт/).first()).toBeVisible();
  // отправить на расценку → статус сменился, блок стал read-only
  await driver.getByRole("button", { name: "Отправить на расценку" }).click();
  await expect(driver.getByText("Отправлено на расценку — ждём цены от диспетчера.")).toBeVisible();

  await mctx.close();
  await dctx.close();
});
