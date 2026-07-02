// Внешний перевозчик (решение Артёма 02.07): полноценный вход водителя — свои задачи и статусы,
// но БЕЗ смен (SHIFT_REQUIRED не применяется), без «Мой расчёт»/KPI. Вход включает админ на
// «Водители — доступ». Общая dev-БД: ассерты по уникальным заголовкам задач.
import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Чистый старт для правила «одна активная задача»: гасим зависшие IN_PROGRESS перед тестом.
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Задача типа без акта на выбранного исполнителя через UI диспетчера.
async function createAssignedTask(milena: Page, driverLabel: string): Promise<{ id: string; title: string }> {
  const title = `e2e external ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e external");
  // Организация/контакт/телефон обязательны при создании (PR #39, 02.07).
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return { id, title };
}

test("внешний перевозчик: админ включает вход, работа без смены, ограничения и изоляция", async ({
  browser,
}) => {
  test.slow();

  // Админ включает вход внешнему перевозчику («Водители — доступ» — та же ручка, что у экрана).
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");
  const list = (await (await artem.request.get("/api/admin/drivers")).json()).data as {
    id: string;
    name: string;
    isExternal: boolean;
    canLogin: boolean;
  }[];
  const carrier = list.find((d) => d.isExternal);
  expect(carrier, "внешний перевозчик есть в списке доступа").toBeTruthy();
  const patch = await artem.request.patch("/api/admin/drivers", {
    data: { driverId: carrier!.id, canLogin: true },
  });
  expect(patch.status()).toBe(200);
  expect((await patch.json()).data.canLogin).toBe(true);

  // Диспетчер назначает ему две задачи + одну чужую (Каширскому) для проверки изоляции.
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const a = await createAssignedTask(milena, "Внешний перевозчик");
  const b = await createAssignedTask(milena, "Внешний перевозчик");
  const foreign = await createAssignedTask(milena, "Алексей Каширский");

  // Перевозчик входит и видит свои задачи; блока смены нет.
  const cctx = await browser.newContext();
  const carrierPage = await cctx.newPage();
  await login(carrierPage, "sultan");
  await carrierPage.goto("/m");
  await expect(carrierPage.getByRole("link", { name: new RegExp(a.title) })).toBeVisible();
  await expect(carrierPage.getByText("Смена не открыта")).toHaveCount(0);
  await expect(carrierPage.getByRole("button", { name: "Открыть смену" })).toHaveCount(0);

  // Берёт задачу в работу БЕЗ смены (SHIFT_REQUIRED не применяется) — прямо из UI карточки.
  await carrierPage.goto(`/m/${a.id}`);
  const takeBtn = carrierPage.getByRole("button", { name: "В работу" });
  await expect(takeBtn).toBeEnabled();
  await expect(carrierPage.getByText("Сначала откройте смену")).toHaveCount(0);
  await takeBtn.click();
  await expect(carrierPage.getByText("В работе").first()).toBeVisible();

  // Вторая задача — 409 ACTIVE_TASK_EXISTS (правило «одна активная» действует и для внешнего).
  const second = await carrierPage.request.post(`/api/tasks/${b.id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(second.status()).toBe(409);
  expect((await second.json()).error.code).toBe("ACTIVE_TASK_EXISTS");

  // Смена запрещена даже прямым запросом; расчёта нет (404); экран расчёта редиректит на /m.
  expect((await carrierPage.request.post("/api/my/shift", { data: { op: "open" } })).status()).toBe(403);
  expect((await carrierPage.request.get("/api/my/kpi")).status()).toBe(404);
  await carrierPage.goto("/m/payroll");
  await carrierPage.waitForURL((url) => url.pathname === "/m");

  // Изоляция: чужая задача (Каширского) по прямому id → 404, диспетчерский список → 403.
  expect((await carrierPage.request.get(`/api/tasks/${foreign.id}`)).status()).toBe(404);
  expect((await carrierPage.request.get(`/api/tasks`)).status()).toBe(403);

  // Завершает свою задачу (тип без акта — гейт причины не задевается).
  const done = await carrierPage.request.post(`/api/tasks/${a.id}/transition`, {
    data: { toStatus: "DONE" },
  });
  expect(done.status()).toBe(200);

  await actx.close();
  await mctx.close();
  await cctx.close();
});

test("ручка доступа водителей — только админ", async ({ browser }) => {
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  expect((await milena.request.get("/api/admin/drivers")).status()).toBe(403);

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await driver.request.get("/api/admin/drivers")).status()).toBe(403);
  expect(
    (await driver.request.patch("/api/admin/drivers", { data: { driverId: "x", canLogin: true } })).status(),
  ).toBe(403);

  await mctx.close();
  await dctx.close();
});
