import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// Этап 14: бумажный акт (фото/скан подписанного бланка — DOCUMENT-вложение) и видимость
// комплектности у диспетчера. Проверяем: цикл ведомости PRICED→SIGNED при приложении акта;
// опись-акт без расценки (worksheetStatus остаётся null); признак комплектности в списке;
// изоляция документа (чужой → 404); откат SIGNED→PRICED при удалении акта.

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

// Валидный 1×1 JPEG — как «фото подписанного акта».
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
    "AAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
  "base64",
);
// Минимальный PDF — как «скан акта». validateUpload смотрит только mime, не содержимое.
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<string> {
  const title = `e2e act ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
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

async function uploadAct(
  req: APIRequestContext,
  taskId: string,
  file: { name: string; mimeType: string; buffer: Buffer } = { name: "akt.jpg", mimeType: "image/jpeg", buffer: JPEG },
) {
  return req.post(`/api/tasks/${taskId}/attachments`, {
    multipart: { file, kind: "DOCUMENT" },
  });
}

async function detail(req: APIRequestContext, taskId: string) {
  return (await (await req.get(`/api/tasks/${taskId}`)).json()).data;
}

test("расценочный тип: приложение акта закрывает ведомость PRICED→SIGNED; диспетчер видит «приложен»", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // ведомость: добавить работу и отправить на расценку → PRICING
  const cat = await (await driver.request.get("/api/work-catalog")).json();
  await driver.request.post(`/api/tasks/${id}/work-items`, { data: { catalogItemId: cat.data[0].id, quantity: 1 } });
  expect((await driver.request.post(`/api/tasks/${id}/worksheet/submit`)).status()).toBe(200);

  // диспетчер расценивает → PRICED
  const d1 = await detail(milena.request, id);
  const items = d1.workItems.map((w: { id: string }) => ({ id: w.id, price: 1500 }));
  expect((await milena.request.post(`/api/tasks/${id}/worksheet/pricing`, { data: { items } })).status()).toBe(200);
  expect((await detail(milena.request, id)).worksheetStatus).toBe("PRICED");

  // водитель прикладывает подписанный акт (фото) → ведомость SIGNED
  expect((await uploadAct(driver.request, id)).status()).toBe(201);
  const after = await detail(milena.request, id);
  expect(after.worksheetStatus).toBe("SIGNED");
  expect(after.attachments.some((a: { kind: string }) => a.kind === "DOCUMENT")).toBe(true);
  // в журнале — событие подписания акта
  expect(after.events.some((e: { kind: string }) => e.kind === "worksheet_signed")).toBe(true);

  // в списке диспетчера у этой задачи проставлен признак комплектности акта
  const list = await (await milena.request.get(`/api/tasks?q=${after.number}`)).json();
  const row = list.data.find((t: { id: string }) => t.id === id);
  expect(row.hasSignedDoc).toBe(true);

  await mctx.close();
  await dctx.close();
});

test("опись-акт (Доставка / забор из аренды, без расценки): акт прикладывается, ведомость не появляется", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Писарев", "Доставка / забор из аренды");

  const before = await detail(milena.request, id);
  expect(before.requiresSignedDoc).toBe(true);
  expect(before.type.requiresPricing).toBe(false);
  expect(before.worksheetStatus).toBeNull();

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  // акт описи можно приложить как PDF-скан
  expect((await uploadAct(driver.request, id, { name: "akt.pdf", mimeType: "application/pdf", buffer: PDF })).status()).toBe(201);

  const after = await detail(milena.request, id);
  expect(after.worksheetStatus).toBeNull(); // ведомости у описи нет — статус не появляется
  const list = await (await milena.request.get(`/api/tasks?q=${after.number}`)).json();
  expect(list.data.find((t: { id: string }) => t.id === id).hasSignedDoc).toBe(true);

  await mctx.close();
  await dctx.close();
});

test("изоляция акта-документа: чужой → 404, гость → 401, владелец/диспетчер → 200; удаление откатывает SIGNED→PRICED", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");

  const actx = await browser.newContext();
  const a = await actx.newPage();
  await login(a, "kashirskiy"); // владелец

  // довести ведомость до PRICED, чтобы проверить откат при удалении акта
  const cat = await (await a.request.get("/api/work-catalog")).json();
  await a.request.post(`/api/tasks/${id}/work-items`, { data: { catalogItemId: cat.data[0].id, quantity: 1 } });
  await a.request.post(`/api/tasks/${id}/worksheet/submit`);
  const d1 = await detail(milena.request, id);
  await milena.request.post(`/api/tasks/${id}/worksheet/pricing`, {
    data: { items: d1.workItems.map((w: { id: string }) => ({ id: w.id, price: 1000 })) },
  });

  // владелец прикладывает акт → SIGNED
  const up = await uploadAct(a.request, id);
  expect(up.status()).toBe(201);
  const attId: string = (await up.json()).data.id;
  expect((await detail(milena.request, id)).worksheetStatus).toBe("SIGNED");

  // чужой водитель (Писарев) и гость не видят документ
  const bctx = await browser.newContext();
  const b = await bctx.newPage();
  await login(b, "pisarev");
  const gctx = await browser.newContext();
  const g = await gctx.newPage();

  expect((await b.request.get(`/api/attachments/${attId}`)).status()).toBe(404); // чужой → 404
  expect((await g.request.get(`/api/attachments/${attId}`)).status()).toBe(401); // гость → 401
  expect((await a.request.get(`/api/attachments/${attId}`)).status()).toBe(200); // владелец → 200
  expect((await milena.request.get(`/api/attachments/${attId}`)).status()).toBe(200); // диспетчер → 200
  // чужой не может удалить акт
  expect((await b.request.delete(`/api/attachments/${attId}`)).status()).toBe(404);

  // владелец удаляет акт (задача не завершена) → откат SIGNED→PRICED
  expect((await a.request.delete(`/api/attachments/${attId}`)).status()).toBe(200);
  const after = await detail(milena.request, id);
  expect(after.worksheetStatus).toBe("PRICED");
  expect(after.events.some((e: { kind: string }) => e.kind === "worksheet_unsigned")).toBe(true);

  await mctx.close();
  await actx.close();
  await bctx.close();
  await gctx.close();
});

test("карточка диспетчера: секция «Акт» — от «ожидается» к «приложен»; PDF открывается ссылкой", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Доставка / забор из ремонта"); // акт-опись, без расценки

  // до приложения акта — секция видна, бейдж «Акт ожидается»
  await milena.goto(`/tasks/${id}`);
  const actSection = milena.locator('[data-testid="act-section"]');
  await expect(actSection).toBeVisible();
  await expect(actSection.getByText("Акт ожидается")).toBeVisible();

  // водитель прикладывает акт
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await uploadAct(driver.request, id, { name: "akt.pdf", mimeType: "application/pdf", buffer: PDF })).status()).toBe(201);

  // карточка диспетчера показывает «Акт приложен» и ссылку на PDF-акт
  await milena.reload();
  await expect(actSection.getByText("Акт приложен")).toBeVisible();
  await expect(actSection.getByRole("link", { name: /Акт \(PDF\)/ })).toBeVisible();

  await mctx.close();
  await dctx.close();
});
