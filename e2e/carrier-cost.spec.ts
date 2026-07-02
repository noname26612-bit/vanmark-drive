// Стоимость поездки внешнего перевозчика + отчёт затрат в Сводке (этап 3, решение Артёма 02.07).
// Деньги компании: поле видно только диспетчеру при внешнем исполнителе, водителям не отдаётся вовсе.
import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Вход внешнему перевозчику включает админ (идемпотентно) — спек не зависит от порядка прогона.
async function enableCarrierLogin(page: Page): Promise<void> {
  const list = (await (await page.request.get("/api/admin/drivers")).json()).data as {
    id: string;
    isExternal: boolean;
  }[];
  const carrier = list.find((d) => d.isExternal);
  expect(carrier).toBeTruthy();
  expect(
    (await page.request.patch("/api/admin/drivers", { data: { driverId: carrier!.id, canLogin: true } })).status(),
  ).toBe(200);
}

test("стоимость поездки: поле у внешнего, скрыта от водителя, попадает в отчёт и CSV", async ({
  browser,
}) => {
  test.slow();
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");
  await enableCarrierLogin(artem);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Форма создания: поле стоимости появляется ТОЛЬКО при внешнем исполнителе.
  const title = `e2e carrier ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e carrier");
  await expect(milena.locator('[data-testid="create-carrier-cost"]')).toHaveCount(0);
  await milena.locator('[data-testid="create-assignee"]').selectOption({ label: "Алексей Каширский" });
  await expect(milena.locator('[data-testid="create-carrier-cost"]')).toHaveCount(0); // штатный — поля нет
  await milena.locator('[data-testid="create-assignee"]').selectOption({ label: "Внешний перевозчик" });
  await expect(milena.locator('[data-testid="create-carrier-cost"]')).toBeVisible();
  await milena.locator('[data-testid="create-carrier-cost"]').fill("7000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];

  // Диспетчер видит стоимость в данных задачи.
  const detail = (await (await milena.request.get(`/api/tasks/${id}`)).json()).data;
  expect(detail.carrierCost).toBe(7000);

  // Водителю (внешнему) стоимость не отдаётся вовсе — ни в карточке, ни в списке, ни в ответе перехода.
  const cctx = await browser.newContext();
  const carrier = await cctx.newPage();
  await login(carrier, "sultan");
  const myDetail = (await (await carrier.request.get(`/api/tasks/${id}`)).json()).data;
  expect(myDetail.title).toBe(title);
  expect("carrierCost" in myDetail).toBe(false);
  const today = new Date().toISOString().slice(0, 10);
  const myList = (await (await carrier.request.get(`/api/my/tasks?date=${today}&scope=today`)).json())
    .data as Record<string, unknown>[];
  expect(myList.length).toBeGreaterThan(0);
  expect(myList.every((t) => !("carrierCost" in t))).toBe(true);

  const took = await carrier.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(took.status()).toBe(200);
  expect("carrierCost" in (await took.json()).data).toBe(false);
  const done = await carrier.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "DONE" } });
  expect(done.status()).toBe(200);
  expect("carrierCost" in (await done.json()).data).toBe(false);

  // Отчёт затрат за сегодня: наша задача с суммой 7000 в списке; CSV отдаётся файлом.
  const report = (await (
    await milena.request.get(`/api/summary/carrier?granularity=day&date=${today}`)
  ).json()).data;
  const row = report.tasks.find((t: { title: string }) => t.title === title);
  expect(row).toBeTruthy();
  expect(row.cost).toBe(7000);
  expect(report.totalCost).toBeGreaterThanOrEqual(7000);

  const csv = await milena.request.get(`/api/summary/carrier/export?granularity=day&date=${today}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(title);

  // Деньги компании — не для водителей: отчёт под водителем закрыт.
  expect((await carrier.request.get(`/api/summary/carrier?granularity=day&date=${today}`)).status()).toBe(403);
  expect((await carrier.request.get(`/api/summary/carrier/export`)).status()).toBe(403);

  await actx.close();
  await mctx.close();
  await cctx.close();
});
