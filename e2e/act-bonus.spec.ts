import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Чистый старт для правила «одна активная задача» (этап B): гасим зависшие IN_PROGRESS перед каждым тестом.
test.beforeEach(resetActiveTasks);

// Этап 15: бонус за комплектность актов (PRD §12.6). +5000₽ при ≥80% завершённых актовых задач
// с приложенным актом, помесячно. Проверяем: счёт базы/комплекта из реальных задач, видимость у
// водителя и диспетчера, внутреннюю консистентность award-логики, фиксацию при закрытии месяца.
// Ассерты к счётчикам — нижними границами (общая dev-БД, тесты идут параллельно и только ДОБАВЛЯЮТ).

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const thisPeriod = new Date().toISOString().slice(0, 7);

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

async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<string> {
  const title = `e2e bonus ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
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

// Доводит назначенную задачу до «Выполнено» руками водителя; опционально прикладывает акт (DOCUMENT).
async function completeActTask(milena: Page, driverReq: APIRequestContext, withAct: boolean): Promise<void> {
  const id = await createAssignedTask(milena, "Алексей Каширский", "Доставка / забор из ремонта"); // акт нужен, расценки нет
  for (const toStatus of ["IN_PROGRESS", "DONE"]) {
    const r = await driverReq.post(`/api/tasks/${id}/transition`, { data: { toStatus } });
    expect(r.status(), `переход в ${toStatus}`).toBe(200);
  }
  if (withAct) {
    const up = await driverReq.post(`/api/tasks/${id}/attachments`, {
      multipart: { file: { name: "akt.jpg", mimeType: "image/jpeg", buffer: JPEG }, kind: "DOCUMENT" },
    });
    expect(up.status()).toBe(201);
  }
}

async function myActBonus(req: APIRequestContext, period: string) {
  const r = await req.get(`/api/my/kpi?period=${period}`);
  expect(r.status()).toBe(200);
  return (await r.json()).data.actBonus;
}

// Внутренняя консистентность объекта бонуса — верна при любых данных (не зависит от общей БД).
function assertConsistent(ab: {
  base: number;
  complete: number;
  percent: number;
  thresholdPercent: number;
  amount: number;
  awarded: boolean;
  value: number;
}) {
  expect(ab.complete).toBeLessThanOrEqual(ab.base);
  expect(ab.value).toBe(ab.awarded ? ab.amount : 0);
  expect(ab.awarded).toBe(ab.base > 0 && ab.complete * 100 >= ab.thresholdPercent * ab.base);
  expect(ab.percent).toBe(ab.base > 0 ? Math.round((ab.complete / ab.base) * 100) : 0);
}

test("счёт комплектности: акт-задача с актом → база+комплект; без акта → только база", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  const before = await myActBonus(driver.request, thisPeriod);
  assertConsistent(before);

  await completeActTask(milena, driver.request, false); // завершена без акта → +база
  await completeActTask(milena, driver.request, true); // завершена с актом → +база и +комплект

  const after = await myActBonus(driver.request, thisPeriod);
  assertConsistent(after);
  // нижние границы: параллельные тесты могут только ДОБАВИТЬ свои задачи, не убрать мои
  expect(after.base).toBeGreaterThanOrEqual(before.base + 2);
  expect(after.complete).toBeGreaterThanOrEqual(before.complete + 1);

  await mctx.close();
  await dctx.close();
});

test("бонус виден водителю и диспетчеру; объект консистентен", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // у водителя в «Мой расчёт»
  const mine = await myActBonus(driver.request, thisPeriod);
  assertConsistent(mine);
  expect(mine.amount).toBeGreaterThan(0); // настроенная сумма бонуса (по умолчанию 5000)
  expect(mine.thresholdPercent).toBeGreaterThan(0);

  // у диспетчера в overview по каждому водителю
  const ov = await (await milena.request.get(`/api/kpi/overview?period=${thisPeriod}`)).json();
  const kash = ov.data.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");
  expect(kash).toBeTruthy();
  expect(kash.actBonus).toBeTruthy();
  assertConsistent(kash.actBonus);

  await mctx.close();
  await dctx.close();
});

test("закрытие месяца фиксирует бонус снимком (изолированный период, без актовых задач → 0)", async ({
  browser,
}) => {
  test.slow();
  const P = "2095-03"; // изолированный период, не используется другими тестами
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // закрытие идемпотентно между прогонами: на первом — 200, на повторных — период уже закрыт.
  await milena.request.post(`/api/kpi/periods/${P}/close`);

  const ov = await (await milena.request.get(`/api/kpi/overview?period=${P}`)).json();
  expect(ov.data.closed).toBe(true);
  const d = ov.data.drivers.find((x: { driverName: string }) => x.driverName === "Алексей Каширский");
  expect(d.closed).toBe(true);
  // в изолированном периоде актовых задач нет → бонус не начислен (нейтрально)
  expect(d.actBonus.base).toBe(0);
  expect(d.actBonus.value).toBe(0);

  // повторное закрытие закрытого месяца отклоняется
  expect((await milena.request.post(`/api/kpi/periods/${P}/close`)).status()).toBe(409);

  await mctx.close();
});
