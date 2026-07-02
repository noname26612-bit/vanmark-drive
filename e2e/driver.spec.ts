import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Чистый старт для правила «одна активная задача» (этап B): гасим зависшие IN_PROGRESS перед каждым тестом.
test.beforeEach(resetActiveTasks);

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
  typeLabel: string,
): Promise<{ id: string; title: string }> {
  const title = `e2e ${driverLabel} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
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
  return { id, title };
}

test("водитель проходит цепочку статусов с телефона (360×740), гео-метка пишется", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  // тип без обязательного фото — цепочку статусов проверяем без фото (фото-поток — в photos.spec)
  const { id, title } = await createAssignedTask(milena, "Алексей Каширский", "Сдача / забор из ТК");

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

  // Цепочка (этап A, схлопнуто): взять «В работу» → «В работе» → «Завершить».
  // У водителя до взятия плашки статуса нет (решение Артёма 24.06) — ждём кнопку действия.
  await expect(driver.getByRole("button", { name: "В работу" })).toBeVisible();
  await driver.getByRole("button", { name: "В работу" }).click();
  await expect(driver.getByText("В работе").first()).toBeVisible();
  // «Завершить →» открывает экран завершения; для типа без обязательного фото — подтверждаем «Завершить»
  await driver.getByRole("button", { name: "Завершить →" }).click();
  await driver.getByRole("button", { name: "Завершить", exact: true }).click();
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
  const { id } = await createAssignedTask(milena, "Алексей Писарев", "Доставка / забор из аренды");

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
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(trans.status()).toBe(404);
  const afterM = await milena.request.get(`/api/tasks/${id}`);
  expect((await afterM.json()).data.status).toBe("ASSIGNED");

  // d) неаутентифицированный → 401 и на списке, и на смене статуса
  const guest = await browser.newContext();
  const g = await guest.newPage();
  expect((await g.request.get(`/api/my/tasks?date=${today}`)).status()).toBe(401);
  expect(
    (await g.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } })).status(),
  ).toBe(401);

  // бонус: диспетчер — не водитель, /api/my/tasks ему отдаёт 403
  expect((await milena.request.get(`/api/my/tasks?date=${today}`)).status()).toBe(403);

  await mctx.close();
  await actx.close();
  await guest.close();
});

// Этап B: у водителя не больше одной задачи «В работе» одновременно.
test("одна активная задача: вторую нельзя взять, пока первая не завершена", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Две задачи на одного водителя (Писарев — реже занят другими тестами на общей БД).
  const t1 = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");
  const t2 = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");

  // Первую берём в работу — ок.
  const r1 = await driver.request.post(`/api/tasks/${t1.id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(r1.status()).toBe(200);

  // Вторую взять нельзя — 409 ACTIVE_TASK_EXISTS.
  const r2 = await driver.request.post(`/api/tasks/${t2.id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(r2.status()).toBe(409);
  expect((await r2.json()).error.code).toBe("ACTIVE_TASK_EXISTS");

  // Завершаем первую — слот освобождается, вторую теперь можно взять.
  const done1 = await driver.request.post(`/api/tasks/${t1.id}/transition`, { data: { toStatus: "DONE" } });
  expect(done1.status()).toBe(200);
  const r2b = await driver.request.post(`/api/tasks/${t2.id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(r2b.status()).toBe(200);

  // Прибираемся: не оставляем pisarev с активной задачей для других тестов на общей БД.
  await driver.request.post(`/api/tasks/${t2.id}/transition`, { data: { toStatus: "DONE" } });

  await mctx.close();
  await dctx.close();
});

// Доработка 4 (решение Артёма 02.07.2026): паузу можно ставить БЕЗ обязательной причины.
test("пауза без причины: водитель ставит ON_HOLD без комментария", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const t = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");

  // Берём в работу.
  const inProg = await driver.request.post(`/api/tasks/${t.id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  expect(inProg.status()).toBe(200);

  // Пауза БЕЗ причины: раньше сервер отвечал 422 REASON_REQUIRED, теперь проходит.
  const hold = await driver.request.post(`/api/tasks/${t.id}/transition`, { data: { toStatus: "ON_HOLD" } });
  expect(hold.status()).toBe(200);
  expect((await hold.json()).data.status).toBe("ON_HOLD");

  // Отмена по-прежнему требует причину — у водителя такого перехода нет, проверяем у диспетчера ниже (tasks.spec).
  // Прибираемся: возобновляем и завершаем, чтобы не оставлять «на паузе»/активную на общей БД.
  await driver.request.post(`/api/tasks/${t.id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  await driver.request.post(`/api/tasks/${t.id}/transition`, { data: { toStatus: "DONE" } });

  await mctx.close();
  await dctx.close();
});
