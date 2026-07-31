import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Этап D: №8 — завершение ON_SITE-задачи без оплаты (с причиной) разрешено, факт сохраняется.
// №6 — активная задача (в работе) помечена бейджем «Активна» у водителя.
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<string> {
  const title = `e2e done ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e завершение");
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

test("№8: ON_SITE можно завершить без оплаты с причиной; без выбора — отказ", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");
  // Делаем оплату «на месте».
  expect((await milena.request.patch(`/api/tasks/${id}`, { data: { op: "edit", paymentType: "ON_SITE", paymentAmount: 5000 } })).ok()).toBeTruthy();
  // Берём в работу (диспетчер ведёт за исполнителя; смена открыта resetActiveTasks).
  expect((await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } })).status()).toBe(200);

  // Завершение без выбора (ни «получено», ни «не получено + причина») → 422 PAYMENT_REQUIRED.
  const noChoice = await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "DONE" } });
  expect(noChoice.status()).toBe(422);
  expect((await noChoice.json()).error.code).toBe("PAYMENT_REQUIRED");

  // Завершение без оплаты с причиной → задача закрыта, факт сохранён, событие в журнале.
  const done = await milena.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "DONE", paymentMissedReason: "Оплатят по счёту" },
  });
  expect(done.status()).toBe(200);

  const detail = (await (await milena.request.get(`/api/tasks/${id}`)).json()).data;
  expect(detail.status).toBe("DONE");
  expect(detail.paymentReceived).toBe(false);
  expect(detail.paymentMissedReason).toBe("Оплатят по счёту");
  expect((detail.events as Array<{ kind: string }>).some((e) => e.kind === "payment_unpaid")).toBe(true);

  await mctx.close();
});

test("№8: ON_SITE с оплатой — paymentReceived=true, событие об оплате", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");
  await milena.request.patch(`/api/tasks/${id}`, { data: { op: "edit", paymentType: "ON_SITE", paymentAmount: 5000 } });
  await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  const done = await milena.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "DONE", paymentConfirmed: true, paymentAmount: 5000 },
  });
  expect(done.status()).toBe(200);

  const detail = (await (await milena.request.get(`/api/tasks/${id}`)).json()).data;
  expect(detail.paymentReceived).toBe(true);
  expect(detail.paymentMissedReason).toBeNull();
  expect((detail.events as Array<{ kind: string }>).some((e) => e.kind === "payment_received")).toBe(true);

  await mctx.close();
});

test("лист завершения ON_SITE: без выбора оплаты кнопка недоступна И причина написана словами", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");
  await milena.request.patch(`/api/tasks/${id}`, { data: { op: "edit", paymentType: "ON_SITE", paymentAmount: 3000 } });
  expect((await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } })).status()).toBe(200);

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await driver.goto(`/m/${id}`);
  await driver.getByRole("button", { name: "Завершить →" }).click();

  // Кнопка задизейблена НЕ молча: рядом причина словами (жалобы 31.07 — «нажимаю, ничего не происходит»).
  const doneBtn = driver.getByRole("button", { name: "Завершить", exact: true });
  await expect(doneBtn).toBeDisabled();
  await expect(driver.locator('[data-testid="complete-hint-payment"]')).toBeVisible();

  // Выбор «Деньги получены» снимает блок: кнопка активна, подсказка исчезла.
  await driver.getByRole("button", { name: /Деньги получены/ }).click();
  await expect(doneBtn).toBeEnabled();
  await expect(driver.locator('[data-testid="complete-hint-payment"]')).toHaveCount(0);

  await mctx.close();
  await dctx.close();
});

test("онлайн-ошибка сервера (500) на завершении показывается сразу, задача не «завершается» молча", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");
  expect((await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } })).status()).toBe(200);

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await driver.goto(`/m/${id}`);

  // Сервер отвечает 500 → водитель видит ошибку сразу; никакого тихого «Выполнено» с поздним откатом.
  await driver.route("**/transition", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL", message: "Внутренняя ошибка" } }),
    }),
  );
  await driver.getByRole("button", { name: "Завершить →" }).click();
  await driver.getByRole("button", { name: "Завершить", exact: true }).click();
  await expect(driver.getByText("Внутренняя ошибка").first()).toBeVisible();
  await expect(driver.getByText("Задача выполнена ✓")).toHaveCount(0);
  await expect(driver.getByText(/Не отправлено:/)).toHaveCount(0); // 500 в очередь не кладём

  // Сервер ожил → повторное нажатие завершает задачу штатно.
  await driver.unroute("**/transition");
  await driver.getByRole("button", { name: "Завершить", exact: true }).click();
  await expect(driver.getByText("Задача выполнена ✓")).toBeVisible({ timeout: 15_000 });

  await mctx.close();
  await dctx.close();
});

test("обрыв сети на завершении: действие в очереди с явным подтверждением, после связи доезжает само", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");
  expect((await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } })).status()).toBe(200);

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await driver.goto(`/m/${id}`);

  // Обрыв связи именно на transition: действие уходит в очередь, водителю говорим об этом явно.
  await driver.route("**/transition", (route) => route.abort("connectionfailed"));
  await driver.getByRole("button", { name: "Завершить →" }).click();
  await driver.getByRole("button", { name: "Завершить", exact: true }).click();
  await expect(driver.getByText("Сохранено — отправится само при связи")).toBeVisible();
  await expect(driver.getByText("Задача выполнена ✓")).toBeVisible(); // оптимистичный статус из очереди

  // Связь вернулась → очередь досылает фоновым тиком (≤15 с) без действий водителя.
  await driver.unroute("**/transition");
  await expect
    .poll(async () => (await (await milena.request.get(`/api/tasks/${id}`)).json()).data.status, { timeout: 25_000 })
    .toBe("DONE");

  await mctx.close();
  await dctx.close();
});

test("№6: активная задача (в работе) — бейдж «Активна» у водителя", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");
  // Переводим в работу — это и есть «активная».
  expect((await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } })).status()).toBe(200);

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await driver.goto("/m");
  // Бейдж «Активна» виден (Badge не форвардит testid — ищем по тексту).
  await expect(driver.getByText("Активна", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await mctx.close();
  await dctx.close();
});
