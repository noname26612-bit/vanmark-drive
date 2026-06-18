import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

// Валидный 1×1 JPEG — достаточно для проверки загрузки/раздачи/сжатия.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
    "AAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
  "base64",
);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Создаёт задачу нужного типа и назначает на водителя через UI; возвращает id.
// opts.waiveAct — снять требование акта галочкой (с причиной), для типов с актом по умолчанию.
async function createAssignedTask(
  milena: Page,
  driverLabel: string,
  typeLabel: string,
  opts: { waiveAct?: { note: string } } = {},
): Promise<string> {
  const title = `e2e photo ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e");
  if (opts.waiveAct) {
    await milena.locator('[data-testid="create-requires-act"]').uncheck();
    await milena.locator('[data-testid="create-act-waived-note"]').fill(opts.waiveAct.note);
  }
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.getByText("Назначена").first()).toBeVisible();
  return id;
}

async function advanceToOnSite(req: APIRequestContext, taskId: string): Promise<void> {
  for (const toStatus of ["ACCEPTED", "EN_ROUTE", "ON_SITE"]) {
    const r = await req.post(`/api/tasks/${taskId}/transition`, { data: { toStatus } });
    expect(r.status(), `переход в ${toStatus}`).toBe(200);
  }
}

test("фото по желанию (360×740): без фото завершается сразу; фото можно приложить", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Сдача в ТК");

  const dctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    permissions: ["geolocation"],
    geolocation: { latitude: 55.75, longitude: 37.61 },
  });
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // доводим до «На месте»
  await driver.goto(`/m/${id}`);
  await driver.getByRole("button", { name: "Принял" }).click();
  await expect(driver.getByText("Принята").first()).toBeVisible();
  await driver.getByRole("button", { name: "Выехал" }).click();
  await expect(driver.getByText("В пути").first()).toBeVisible();
  await driver.getByRole("button", { name: "На месте" }).click();
  await expect(driver.getByText("На месте").first()).toBeVisible();

  // экран завершения — «Завершить» доступна сразу, фото не обязательно (этап 11)
  await driver.getByRole("button", { name: "Выполнено" }).click();
  await expect(driver.getByRole("button", { name: "Завершить" })).toBeEnabled();

  // фото можно приложить по желанию
  await driver.locator("input[capture]").setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG,
  });
  await driver.getByRole("button", { name: "Завершить" }).click();
  await expect(driver.getByText("Задача выполнена ✓")).toBeVisible();

  await expect
    .poll(
      async () => {
        const r = await milena.request.get(`/api/tasks/${id}`);
        return (await r.json()).data.status as string;
      },
      { timeout: 10_000 },
    )
    .toBe("DONE");
  const detail = await milena.request.get(`/api/tasks/${id}`);
  expect((await detail.json()).data.attachments.length).toBeGreaterThanOrEqual(1);

  await mctx.close();
  await dctx.close();
});

test("фото и акт НЕ блокируют DONE на сервере (любой тип завершается без вложений)", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // тип с актом «Выездной ремонт / диагностика»: DONE без фото и без акта — проходит (мягкое требование KPI)
  const repair = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");
  await advanceToOnSite(driver.request, repair);
  const doneRepair = await driver.request.post(`/api/tasks/${repair}/transition`, {
    data: { toStatus: "DONE" },
  });
  expect(doneRepair.status()).toBe(200);
  expect((await doneRepair.json()).data.status).toBe("DONE");

  // тип без акта «Сдача в ТК»: DONE без фото — проходит
  const tk = await createAssignedTask(milena, "Алексей Каширский", "Сдача в ТК");
  await advanceToOnSite(driver.request, tk);
  const doneTk = await driver.request.post(`/api/tasks/${tk}/transition`, {
    data: { toStatus: "DONE" },
  });
  expect(doneTk.status()).toBe(200);
  expect((await doneTk.json()).data.status).toBe("DONE");

  await mctx.close();
  await dctx.close();
});

test("галочка «акт не нужен» снимает требование акта на заявке (с причиной)", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // по умолчанию выездной ремонт требует акт (снимок из типа)
  const withAct = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");
  const a = await (await milena.request.get(`/api/tasks/${withAct}`)).json();
  expect(a.data.requiresSignedDoc).toBe(true);
  expect(a.data.actWaivedNote).toBeNull();

  // та же задача, но диспетчер снял требование акта с причиной
  const waived = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика", {
    waiveAct: { note: "подпишут по ЭДО" },
  });
  const w = await (await milena.request.get(`/api/tasks/${waived}`)).json();
  expect(w.data.requiresSignedDoc).toBe(false);
  expect(w.data.actWaivedNote).toBe("подпишут по ЭДО");

  await mctx.close();
});

test("оплата на месте: DONE без подтверждения → PAYMENT_REQUIRED; с подтверждением → отметка в истории", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // ставим оплату «на месте» правкой задачи; тип без акта — чтобы изолировать гейт оплаты
  const id = await createAssignedTask(milena, "Алексей Каширский", "Сдача в ТК");
  const patch = await milena.request.patch(`/api/tasks/${id}`, {
    data: { op: "edit", paymentType: "ON_SITE", paymentAmount: 5000 },
  });
  expect(patch.status()).toBe(200);

  await advanceToOnSite(driver.request, id);

  const blocked = await driver.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "DONE" },
  });
  expect(blocked.status()).toBe(422);
  expect((await blocked.json()).error.code).toBe("PAYMENT_REQUIRED");

  const done = await driver.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "DONE", paymentConfirmed: true, paymentAmount: 5000 },
  });
  expect(done.status()).toBe(200);

  // в истории есть отметка о деньгах
  const detail = await milena.request.get(`/api/tasks/${id}`);
  const events = (await detail.json()).data.events as Array<{ kind: string; comment: string | null }>;
  expect(events.some((e) => e.kind === "payment_received")).toBe(true);

  await mctx.close();
  await dctx.close();
});

test("изоляция файлов: чужой водитель → 404, гость → 401, владелец и диспетчер → 200", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  // задача водителя A (Каширский); фото грузит диспетчер
  const id = await createAssignedTask(milena, "Алексей Каширский", "Доставка в аренду");
  const up = await milena.request.post(`/api/tasks/${id}/attachments`, {
    multipart: { file: { name: "p.jpg", mimeType: "image/jpeg", buffer: JPEG } },
  });
  expect(up.status()).toBe(201);
  const attId: string = (await up.json()).data.id;

  // водитель A — владелец задачи
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await login(a, "kashirskiy");
  // водитель B — чужой
  const bctx = await browser.newContext();
  const b = await bctx.newPage();
  await login(b, "pisarev");
  // гость — без входа
  const gctx = await browser.newContext();
  const g = await gctx.newPage();

  expect((await b.request.get(`/api/attachments/${attId}`)).status()).toBe(404); // чужой → 404
  expect((await g.request.get(`/api/attachments/${attId}`)).status()).toBe(401); // гость → 401
  expect((await a.request.get(`/api/attachments/${attId}`)).status()).toBe(200); // владелец → 200
  expect((await milena.request.get(`/api/attachments/${attId}`)).status()).toBe(200); // диспетчер → 200

  // и удалить чужой файл водитель B не может
  expect((await b.request.delete(`/api/attachments/${attId}`)).status()).toBe(404);

  await mctx.close();
  await actx.close();
  await bctx.close();
  await gctx.close();
});
