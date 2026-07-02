import { test, expect, type Page } from "@playwright/test";

// Разделы справочника + авто-подстановка цены-подсказки при расценке. Водитель видит работы
// сгруппированными по разделам, но ЦЕН НЕ видит (ни в справочнике, ни в карточке задачи). Диспетчеру
// цена-подсказка подставляется в расценку. Разделами/ценами управляет только админ.

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createAssignedRepairTask(milena: Page): Promise<string> {
  const title = `e2e cat ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Выездной ремонт / диагностика" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e");
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Каширский" });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return id;
}

test("разделы: админ создаёт раздел и позицию; водитель видит по разделам без цены; чужой не правит", async ({
  browser,
}) => {
  test.slow();
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const catName = `e2e раздел ${stamp}`;
  const itemName = `e2e работа ${stamp}`;

  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");

  // раздел + позиция в нём с ценой-подсказкой
  const cat = await artem.request.post("/api/admin/work-categories", { data: { name: catName, sortOrder: 50 } });
  expect(cat.status()).toBe(201);
  const catId: string = (await cat.json()).data.id;
  const item = await artem.request.post("/api/admin/work-catalog", {
    data: { name: itemName, defaultPrice: 3300, categoryId: catId },
  });
  expect(item.status()).toBe(201);

  // водитель видит позицию с разделом, но БЕЗ цены
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  const wc = await (await driver.request.get("/api/work-catalog")).json();
  const row = wc.data.find((w: { name: string }) => w.name === itemName);
  expect(row).toBeTruthy();
  expect(row.categoryName).toBe(catName);
  expect("defaultPrice" in row).toBe(false);

  // изоляция: не-админ не создаёт раздел и не правит его
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  expect((await milena.request.post("/api/admin/work-categories", { data: { name: "x" } })).status()).toBe(403);
  expect((await driver.request.patch(`/api/admin/work-categories/${catId}`, { data: { name: "взлом" } })).status()).toBe(403);

  await actx.close();
  await dctx.close();
  await mctx.close();
});

test("расценка: цена-подсказка подставляется диспетчеру; водитель её не видит в карточке", async ({ browser }) => {
  test.slow();
  const itemName = `e2e прайс ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");
  const created = await artem.request.post("/api/admin/work-catalog", { data: { name: itemName, defaultPrice: 4500 } });
  expect(created.status()).toBe(201);
  const catalogItemId: string = (await created.json()).data.id;

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const taskId = await createAssignedRepairTask(milena);

  // водитель добавляет позицию ведомости из справочника
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  const add = await driver.request.post(`/api/tasks/${taskId}/work-items`, { data: { catalogItemId, quantity: 1 } });
  expect(add.status()).toBe(201);

  // диспетчер видит цену-подсказку у позиции; водитель — НЕ видит (поля нет)
  const forMilena = await (await milena.request.get(`/api/tasks/${taskId}`)).json();
  const wiM = forMilena.data.workItems.find((w: { catalogItemId: string | null }) => w.catalogItemId === catalogItemId);
  expect(wiM.defaultPrice).toBe(4500);

  const forDriver = await (await driver.request.get(`/api/tasks/${taskId}`)).json();
  const wiD = forDriver.data.workItems.find((w: { catalogItemId: string | null }) => w.catalogItemId === catalogItemId);
  expect("defaultPrice" in wiD).toBe(false);

  await actx.close();
  await mctx.close();
  await dctx.close();
});
