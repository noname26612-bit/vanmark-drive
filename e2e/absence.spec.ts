import { test, expect, type Page } from "@playwright/test";

// Этап E: №9 — отпуска/больничные водителей в Календаре загрузки. CRUD, отображение, изоляция,
// KPI-исключение (в отпуск не штрафуем «невыполненную точку»).
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const today = new Date().toISOString().slice(0, 10);
const plus13 = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function pisarevId(milena: Page): Promise<string> {
  const cal = (await (await milena.request.get(`/api/capacity/calendar?from=${today}&to=${plus13}`)).json()).data;
  const d = (cal.drivers as Array<{ id: string; name: string }>).find((x) => x.name === "Алексей Писарев");
  expect(d).toBeTruthy();
  return d!.id;
}

async function createDatedTask(milena: Page, driverLabel: string, date: string): Promise<{ id: string; title: string }> {
  const title = `e2e abs ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача в ТК" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e отпуск");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.getByText("Назначена").first()).toBeVisible();
  await milena.request.patch(`/api/tasks/${id}`, { data: { op: "edit", scheduledDate: date } });
  return { id, title };
}

test("№9: CRUD отпуска, виден в календаре, изоляция от водителя", async ({ browser }) => {
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const driverId = await pisarevId(milena);

  // Заводим отпуск.
  const created = await milena.request.post("/api/absences", {
    data: { driverId, dateFrom: today, dateTo: plus13, type: "VACATION", note: "e2e отпуск" },
  });
  expect(created.status()).toBe(200);
  const absId = (await created.json()).data.id;

  // Виден в календаре по водителю.
  const cal = (await (await milena.request.get(`/api/capacity/calendar?from=${today}&to=${plus13}`)).json()).data;
  expect((cal.absences[driverId] ?? []).some((a: { id: string }) => a.id === absId)).toBe(true);

  // Изоляция: водителю ручки отпусков недоступны (403).
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  expect(
    (await driver.request.post("/api/absences", { data: { driverId, dateFrom: today, dateTo: today } })).status(),
  ).toBe(403);
  expect((await driver.request.get(`/api/absences?from=${today}&to=${plus13}`)).status()).toBe(403);

  // Удаляем — уходит из календаря.
  expect((await milena.request.delete(`/api/absences/${absId}`)).status()).toBe(200);
  const cal2 = (await (await milena.request.get(`/api/capacity/calendar?from=${today}&to=${plus13}`)).json()).data;
  expect((cal2.absences[driverId] ?? []).some((a: { id: string }) => a.id === absId)).toBe(false);

  await mctx.close();
  await dctx.close();
});

test("№9: в дни отпуска не штрафуем «невыполненную точку»", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const driverId = await pisarevId(milena);
  const period = yesterday.slice(0, 7);

  // Задача на вчера, назначена и не закрыта → обычно была бы «невыполненная точка».
  const { title } = await createDatedTask(milena, "Алексей Писарев", yesterday);
  // Но водитель вчера был в отпуске.
  const abs = await milena.request.post("/api/absences", {
    data: { driverId, dateFrom: yesterday, dateTo: yesterday, type: "VACATION" },
  });
  const absId = (await abs.json()).data.id;

  // Детект — кандидата «невыполненная точка» по этой задаче НЕ создаётся.
  expect((await milena.request.post("/api/kpi/detect", { data: { date: yesterday } })).status()).toBe(200);
  const ov = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  expect(ov.candidates.find((c: { taskTitle: string | null }) => c.taskTitle === title)).toBeFalsy();

  // Уберём отпуск (общая dev-БД) — чтобы не влиял на другие прогоны.
  await milena.request.delete(`/api/absences/${absId}`);
  await mctx.close();
});

test("№9: отпуск можно завести только водителю", async ({ browser }) => {
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  // Несуществующий/не-водительский id → отказ (валидация на сервере).
  const r = await milena.request.post("/api/absences", {
    data: { driverId: "00000000-0000-0000-0000-000000000000", dateFrom: today, dateTo: today },
  });
  expect([400, 422]).toContain(r.status());
  await mctx.close();
});
