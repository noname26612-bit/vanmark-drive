import { test, expect, type Page } from "@playwright/test";
import { resetShifts } from "./reset";

// Смены теста изолированы: перед каждым тестом чистим (общая dev-БД, @@unique(driverId, date)).
test.beforeEach(resetShifts);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const today = new Date().toISOString().slice(0, 10);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Диспетчер создаёт задачу и назначает водителю через UI (как в driver.spec).
async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<string> {
  const title = `e2e shift ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
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

test("смена: водитель открывает → диспетчер подтверждает → водитель закрывает", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");

  // Утром смены нет.
  let r = await driver.request.get(`/api/my/shift?date=${today}`);
  expect(r.status()).toBe(200);
  expect((await r.json()).data).toBeNull();

  // Водитель открывает смену — статус REQUESTED (ждёт подтверждения).
  r = await driver.request.post(`/api/my/shift`, { data: { op: "open", today } });
  expect(r.status()).toBe(200);
  const opened = (await r.json()).data;
  expect(opened.status).toBe("REQUESTED");
  const shiftId: string = opened.id;

  // Диспетчер видит запрос на открытие и подтверждает приход.
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const list = (await (await milena.request.get(`/api/shifts?date=${today}`)).json()).data as {
    id: string;
    status: string;
  }[];
  expect(list.some((s) => s.id === shiftId && s.status === "REQUESTED")).toBe(true);
  const confirmR = await milena.request.post(`/api/shifts/${shiftId}/confirm`, { data: {} });
  expect(confirmR.status()).toBe(200);
  expect((await confirmR.json()).data.status).toBe("OPEN");

  // Водитель видит OPEN и закрывает смену в конце дня.
  r = await driver.request.get(`/api/my/shift?date=${today}`);
  expect((await r.json()).data.status).toBe("OPEN");
  r = await driver.request.post(`/api/my/shift`, { data: { op: "close", today } });
  expect(r.status()).toBe(200);
  expect((await r.json()).data.status).toBe("CLOSED");

  await dctx.close();
  await mctx.close();
});

test("смена через UI: водитель открывает (360×740), диспетчер подтверждает на доске", async ({ browser }) => {
  test.slow();
  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await driver.goto("/m");
  await driver.getByRole("button", { name: "Открыть смену" }).click();
  await expect(driver.getByText(/ждёт подтверждения/)).toBeVisible();

  // Диспетчер на доске видит блок «Открытие смен» и подтверждает приход.
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  await milena.goto("/board");
  const block = milena.getByTestId("shifts-block");
  await expect(block).toBeVisible();
  await block.getByRole("button", { name: "Подтвердить" }).first().click();

  // Водитель видит «Смена идёт» (поллинг 10 с).
  await expect(driver.getByText(/Смена идёт/)).toBeVisible({ timeout: 15_000 });

  await dctx.close();
  await mctx.close();
});

test("изоляция смен: водитель не подтверждает и не видит список; гость — 401", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const shiftId: string = (
    await (await driver.request.post(`/api/my/shift`, { data: { op: "open", today } })).json()
  ).data.id;

  // Подтверждение и список смен — диспетчерские ручки, водителю 403.
  expect((await driver.request.post(`/api/shifts/${shiftId}/confirm`, { data: {} })).status()).toBe(403);
  expect((await driver.request.get(`/api/shifts?date=${today}`)).status()).toBe(403);

  // Гость — 401 на всех ручках смен.
  const guest = await browser.newContext();
  const g = await guest.newPage();
  expect((await g.request.post(`/api/my/shift`, { data: { op: "open", today } })).status()).toBe(401);
  expect((await g.request.get(`/api/my/shift?date=${today}`)).status()).toBe(401);
  expect((await g.request.post(`/api/shifts/${shiftId}/confirm`, { data: {} })).status()).toBe(401);

  await dctx.close();
  await guest.close();
});

// Переоткрытие случайно закрытой смены водителем: CLOSED → OPEN, и задачу снова можно взять в работу.
test("смена: водитель возобновляет случайно закрытую смену и снова берёт задачу", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");

  // Открыл → диспетчер подтвердил → водитель случайно закрыл.
  const shiftId: string = (
    await (await driver.request.post(`/api/my/shift`, { data: { op: "open", today } })).json()
  ).data.id;
  await milena.request.post(`/api/shifts/${shiftId}/confirm`, { data: {} });
  let r = await driver.request.post(`/api/my/shift`, { data: { op: "close", today } });
  expect((await r.json()).data.status).toBe("CLOSED");

  // Пока закрыта — взять задачу нельзя.
  r = await driver.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(r.status()).toBe(409);
  expect((await r.json()).error.code).toBe("SHIFT_REQUIRED");

  // Возобновил сам — подтверждённая смена возвращается в OPEN.
  r = await driver.request.post(`/api/my/shift`, { data: { op: "reopen", today } });
  expect(r.status()).toBe(200);
  expect((await r.json()).data.status).toBe("OPEN");

  // Теперь задачу можно взять в работу.
  r = await driver.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(r.status()).toBe(200);

  await mctx.close();
  await dctx.close();
});

// Переоткрытие диспетчером по id; водителю диспетчерская ручка переоткрытия недоступна (изоляция).
test("смена: диспетчер переоткрывает закрытую смену, водителю PATCH запрещён", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const shiftId: string = (
    await (await driver.request.post(`/api/my/shift`, { data: { op: "open", today } })).json()
  ).data.id;

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  await milena.request.post(`/api/shifts/${shiftId}/confirm`, { data: {} });
  await driver.request.post(`/api/my/shift`, { data: { op: "close", today } });

  // Диспетчер переоткрывает по id → OPEN.
  const re = await milena.request.patch(`/api/shifts/${shiftId}`, { data: { op: "reopen" } });
  expect(re.status()).toBe(200);
  expect((await re.json()).data.status).toBe("OPEN");

  // Водитель не может дёргать диспетчерскую ручку переоткрытия (403).
  expect(
    (await driver.request.patch(`/api/shifts/${shiftId}`, { data: { op: "reopen" } })).status(),
  ).toBe(403);

  await dctx.close();
  await mctx.close();
});

// Этап D: без открытой смены задачу в работу взять нельзя (smena чистится в beforeEach).
test("без открытой смены задачу в работу взять нельзя (SHIFT_REQUIRED)", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  // Смены у водителя нет (resetShifts) → взятие в работу отклоняется.
  const r = await driver.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(r.status()).toBe(409);
  expect((await r.json()).error.code).toBe("SHIFT_REQUIRED");

  await mctx.close();
  await dctx.close();
});
