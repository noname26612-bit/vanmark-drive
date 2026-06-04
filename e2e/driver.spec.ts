import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const today = new Date().toISOString().slice(0, 10);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Диспетчер создаёт задачу и назначает её на водителя через UI. Возвращает id и заголовок.
async function createAssignedTask(
  milena: Page,
  driverLabel: string,
): Promise<{ id: string; title: string }> {
  const title = `e2e ${driverLabel} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.getByText("Назначена").first()).toBeVisible();
  return { id, title };
}

test("водитель проходит цепочку статусов с телефона (360×740), гео-метка пишется", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id, title } = await createAssignedTask(milena, "Алексей Каширский");

  // Водитель — мобильный вьюпорт + разрешённая геолокация (метка должна записаться)
  const dctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    permissions: ["geolocation"],
    geolocation: { latitude: 55.751244, longitude: 37.618423 },
  });
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  await driver.goto("/m");
  // Назначенная задача без даты видна на вкладке «Сегодня» (решение Артёма — «свернуть в Сегодня»)
  const card = driver.getByText(title);
  await expect(card).toBeVisible();
  await card.click();
  await driver.waitForURL(/\/m\/[0-9a-f-]+$/);

  // Цепочка: Назначена → Принял → Выехал → На месте → Выполнено
  await expect(driver.getByText("Назначена").first()).toBeVisible();
  await driver.getByRole("button", { name: "Принял" }).click();
  await expect(driver.getByText("Принята").first()).toBeVisible();
  await driver.getByRole("button", { name: "Выехал" }).click();
  await expect(driver.getByText("В пути").first()).toBeVisible();
  await driver.getByRole("button", { name: "На месте" }).click();
  await expect(driver.getByText("На месте").first()).toBeVisible();
  await driver.getByRole("button", { name: "Выполнено" }).click();
  await expect(driver.getByText("Выполнена").first()).toBeVisible();
  await expect(driver.getByText("Задача выполнена ✓")).toBeVisible();

  // Гео-метка: у задачи есть хотя бы одно событие с координатами (как видит диспетчер)
  const detail = await milena.request.get(`/api/tasks/${id}`);
  const events = (await detail.json()).data.events as Array<{ lat: number | null }>;
  expect(events.some((e) => e.lat !== null)).toBe(true);

  await mctx.close();
  await dctx.close();
});

test("изоляция: водитель A не видит и не меняет задачу водителя B", async ({ browser }) => {
  test.slow();
  // Диспетчер заводит задачу для водителя B (Писарев)
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id } = await createAssignedTask(milena, "Алексей Писарев");

  // Водитель A (Каширский) в отдельном контексте
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await login(a, "kashirskiy");

  // a) список A (обе вкладки) не содержит чужую задачу
  const todayRes = await a.request.get(`/api/my/tasks?date=${today}&scope=today`);
  expect(todayRes.status()).toBe(200);
  const upcomingRes = await a.request.get(`/api/my/tasks?date=${today}&scope=upcoming`);
  const ids = [...(await todayRes.json()).data, ...(await upcomingRes.json()).data].map(
    (t: { id: string }) => t.id,
  );
  expect(ids).not.toContain(id);

  // b) чужая задача по прямому id → 404 (не 403 — не раскрываем существование)
  expect((await a.request.get(`/api/tasks/${id}`)).status()).toBe(404);

  // c) смена статуса чужой задачи → 404, и статус B НЕ изменился
  const trans = await a.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "ACCEPTED" },
  });
  expect(trans.status()).toBe(404);
  const afterM = await milena.request.get(`/api/tasks/${id}`);
  expect((await afterM.json()).data.status).toBe("ASSIGNED");

  // d) неаутентифицированный → 401 и на списке, и на смене статуса
  const guest = await browser.newContext();
  const g = await guest.newPage();
  expect((await g.request.get(`/api/my/tasks?date=${today}`)).status()).toBe(401);
  expect(
    (await g.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "ACCEPTED" } })).status(),
  ).toBe(401);

  // бонус: диспетчер — не водитель, /api/my/tasks ему отдаёт 403
  expect((await milena.request.get(`/api/my/tasks?date=${today}`)).status()).toBe(403);

  await mctx.close();
  await actx.close();
  await guest.close();
});
