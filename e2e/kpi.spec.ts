import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const thisPeriod = new Date().toISOString().slice(0, 7);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Создаёт задачу через UI, назначает водителю и проставляет дату через API (для детектора).
async function createDatedTask(
  milena: Page,
  driverLabel: string,
  typeLabel: string,
  date: string,
): Promise<{ id: string; title: string }> {
  const title = `e2e-kpi ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e KPI");
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  // дату ставим через API (форма создания даёт пул «без даты»)
  const patch = await milena.request.patch(`/api/tasks/${id}`, {
    data: { op: "edit", scheduledDate: date },
  });
  expect(patch.ok()).toBeTruthy();
  return { id, title };
}

test("детектор находит нарушение из реальной задачи, диспетчер подтверждает", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");
  // Штраф (penalty) проверяем через админа: диспетчер зарплату/штрафы в расчёте больше не видит (№10).
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");

  // Задача на вчера, назначена и НЕ доведена до DONE → кандидат «невыполненная точка».
  const { title } = await createDatedTask(milena, "Алексей Каширский", "Сдача / забор из ТК", yesterday);
  const period = yesterday.slice(0, 7);

  const det = await milena.request.post("/api/kpi/detect", { data: { date: yesterday } });
  expect(det.status()).toBe(200);

  // Кандидат появился в overview именно по нашей задаче.
  const ov1 = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  const cand = ov1.candidates.find((c: { taskTitle: string | null }) => c.taskTitle === title);
  expect(cand).toBeTruthy();
  expect(cand.kind).toBe("MISSED_STOP");

  const ovA1 = (await (await artem.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  const before = ovA1.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");

  // Подтверждаем одним действием (диспетчер).
  const res = await milena.request.post(`/api/kpi/marks/${cand.id}/resolve`, {
    data: { status: "CONFIRMED" },
  });
  expect(res.status()).toBe(200);

  // После подтверждения кандидат уходит из списка (у диспетчера), штраф водителя растёт (у админа).
  const ov2 = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  expect(ov2.candidates.find((c: { taskTitle: string | null }) => c.taskTitle === title)).toBeFalsy();
  const ovA2 = (await (await artem.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  const after = ovA2.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");
  expect(after.penalty).toBeGreaterThan(before.penalty);

  await ctx.close();
  await actx.close();
});

test("изоляция: водитель видит только свой расчёт, диспетчерские ручки KPI закрыты", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // Свой расчёт доступен.
  const mine = await driver.request.get(`/api/my/kpi?period=${thisPeriod}`);
  expect(mine.status()).toBe(200);
  expect((await mine.json()).data.driverName).toBe("Алексей Каширский");

  // driverId берётся из сессии — подмена в query игнорируется (всё равно свой расчёт).
  const spoof = await driver.request.get(`/api/my/kpi?period=${thisPeriod}&driverId=11111111-1111-1111-1111-111111111111`);
  expect((await spoof.json()).data.driverName).toBe("Алексей Каширский");

  // Диспетчерские/админские ручки KPI водителю запрещены (403, не данные).
  expect((await driver.request.get(`/api/kpi/overview?period=${thisPeriod}`)).status()).toBe(403);
  expect((await driver.request.post(`/api/kpi/detect`, { data: {} })).status()).toBe(403);
  expect(
    (await driver.request.post(`/api/kpi/marks`, { data: { driverId: "x", amount: -1, period: thisPeriod } })).status(),
  ).toBe(403);
  expect((await driver.request.get(`/api/admin/pay-profiles`)).status()).toBe(403);
  expect((await driver.request.put(`/api/admin/kpi-rules`, { data: { kind: "LATE", weight: 1 } })).status()).toBe(403);

  // Гость без сессии → 401.
  const gctx = await browser.newContext();
  const g = await gctx.newPage();
  expect((await g.request.get(`/api/my/kpi?period=${thisPeriod}`)).status()).toBe(401);

  await dctx.close();
  await gctx.close();
});

test("закрытый месяц неизменен: правки отметок и повторное закрытие отклоняются", async ({ browser }) => {
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");

  const P = "2099-12"; // фиктивный изолированный период

  const ov = (await (await milena.request.get(`/api/kpi/overview?period=${P}`)).json()).data;
  const kash = ov.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");
  expect(kash).toBeTruthy();

  // Закрыть (или он уже закрыт прошлым прогоном) — после этого месяц точно закрыт.
  const c1 = await milena.request.post(`/api/kpi/periods/${P}/close`);
  expect([200, 409]).toContain(c1.status());

  // Повторное закрытие → 409 PERIOD_CLOSED.
  expect((await milena.request.post(`/api/kpi/periods/${P}/close`)).status()).toBe(409);

  // Ручная отметка в закрытый месяц → 409.
  const mark = await milena.request.post(`/api/kpi/marks`, {
    data: { driverId: kash.driverId, amount: -1000, period: P },
  });
  expect(mark.status()).toBe(409);

  // Расчёт закрытого месяца отдаётся снимком (closed=true).
  const ov2 = (await (await milena.request.get(`/api/kpi/overview?period=${P}`)).json()).data;
  expect(ov2.closed).toBe(true);
  expect(ov2.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский").closed).toBe(true);

  await ctx.close();
});
