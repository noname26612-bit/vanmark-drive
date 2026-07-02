import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks, resetShifts } from "./reset";

// Офлайн-режим водителя: действие без сети копится в очереди (оптимистичный оверлей + «не отправлено»)
// и досылается синхронизатором при возврате связи (с Idempotency-Key — ровно один эффект).
// beforeEach: гасим зависшие IN_PROGRESS и открываем смену (иначе SHIFT_REQUIRED).
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<{ id: string; title: string }> {
  const title = `e2e-offline ${driverLabel} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e offline");
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

test("офлайн: смена статуса копится в очереди и досылается при возврате связи", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id, title } = await createAssignedTask(milena, "Алексей Каширский", "Сдача / забор из ТК");

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  await driver.goto("/m");
  await driver.getByText(title).click(); // карточку открываем онлайн (в dev нет SW-precache офлайн)
  await driver.waitForURL(/\/m\/[0-9a-f-]+$/);
  await expect(driver.getByRole("button", { name: "В работу" })).toBeVisible();

  // Уходим в офлайн и берём задачу в работу.
  await dctx.setOffline(true);
  await driver.getByRole("button", { name: "В работу" }).click();

  // Оверлей: статус оптимистично «В работе» + индикатор «Не отправлено».
  await expect(driver.getByText("В работе").first()).toBeVisible();
  await expect(driver.getByText(/Не отправлено/)).toBeVisible();

  // На сервере действие ещё НЕ применилось (офлайн) — статус остаётся ASSIGNED.
  const beforeSync = await milena.request.get(`/api/tasks/${id}`);
  expect((await beforeSync.json()).data.status).toBe("ASSIGNED");

  // Возвращаем связь — синхронизатор досылает очередь (online-событие + фоновый тик).
  await dctx.setOffline(false);
  await expect
    .poll(async () => (await (await milena.request.get(`/api/tasks/${id}`)).json()).data.status, {
      timeout: 15_000,
    })
    .toBe("IN_PROGRESS");

  // После досылки индикатор «не отправлено» уходит.
  await expect(driver.getByText(/Не отправлено/)).toBeHidden();

  // Время события — момент действия на телефоне (X-Occurred-At), записано серверу.
  const events = (await (await milena.request.get(`/api/tasks/${id}`)).json()).data.events as Array<{
    toStatus: string | null;
  }>;
  expect(events.some((e) => e.toStatus === "IN_PROGRESS")).toBe(true);

  // Прибираемся: не оставляем активную задачу на общей dev-БД.
  await driver.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "DONE" } });

  await mctx.close();
  await dctx.close();
});

// O7 «утро без связи», UI: без сети водитель открывает смену (оверлей показывает «ждёт подтверждения»
// с бейджем «не отправлено»), при возврате связи открытие досылается, и задача берётся в работу.
test("офлайн: смена открывается без связи и досылается; после связи задача берётся в работу", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id, title } = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  // Стартуем без смены (beforeEach их открыл — убираем; удаляются все, но каждый тест готовит свои).
  await resetShifts();
  await driver.goto("/m");
  await expect(driver.getByText("Смена не открыта")).toBeVisible();

  // Утро без связи: открыть смену офлайн → мгновенный оверлей + пометка «не отправлено».
  await dctx.setOffline(true);
  await driver.getByRole("button", { name: "Открыть смену" }).click();
  await expect(driver.getByText(/ждёт подтверждения/)).toBeVisible();
  await expect(driver.getByText(/Не отправлено — уйдёт при связи/)).toBeVisible();

  // На сервере смены ещё нет.
  const before = (await (await milena.request.get(`/api/shifts?date=${new Date().toISOString().slice(0, 10)}`)).json())
    .data as { id: string }[];
  expect(before.length).toBe(0);

  // Связь вернулась → очередь досылает открытие (тик ≤15 с), бейдж уходит.
  await dctx.setOffline(false);
  await expect
    .poll(
      async () =>
        ((await (await milena.request.get(`/api/shifts?date=${new Date().toISOString().slice(0, 10)}`)).json())
          .data as { status: string }[]).length,
      { timeout: 20_000 },
    )
    .toBe(1);
  await expect(driver.getByText(/Не отправлено — уйдёт при связи/)).toBeHidden();

  // Смена дослана — водитель открывает карточку и берёт задачу в работу (гейт SHIFT_REQUIRED пройден).
  await driver.getByText(title).click();
  await driver.waitForURL(/\/m\/[0-9a-f-]+$/);
  await driver.getByRole("button", { name: "В работу" }).click();
  await expect
    .poll(async () => (await (await milena.request.get(`/api/tasks/${id}`)).json()).data.status, {
      timeout: 15_000,
    })
    .toBe("IN_PROGRESS");

  // Прибираемся: закрываем задачу (правило «одна активная» на общей dev-БД).
  await driver.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "DONE" } });

  await mctx.close();
  await dctx.close();
});

// O7, серверный контракт досылки: open из очереди несёт Idempotency-Key + X-Occurred-At (время
// нажатия). Сервер: день/время смены = момент нажатия, пометка openedOffline, повторы без дублей,
// transition после open проходит без SHIFT_REQUIRED. Милена видит пометку «офлайн» на доске.
test("досылка смены: время нажатия, пометка «офлайн» у Милены, повторы без дублей", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id } = await createAssignedTask(milena, "Алексей Писарев", "Сдача / забор из ТК");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await resetShifts();

  const today = new Date().toISOString().slice(0, 10);
  // Нажатие «5 минут назад» (как из офлайн-очереди). Не гоняем тест в первые минуты после полуночи —
  // иначе день нажатия уедет на вчера (это штатное поведение, но ассерты ниже смотрят сегодня).
  const pressedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const openKey = crypto.randomUUID();
  const headers = { "Idempotency-Key": openKey, "X-Occurred-At": pressedAt };

  // Досылка открытия: время смены = момент нажатия, пометка «открыта офлайн».
  let r = await driver.request.post(`/api/my/shift`, { data: { op: "open" }, headers });
  expect(r.status()).toBe(200);
  const opened = (await r.json()).data as { id: string; openedAt: string; openedOffline: boolean };
  expect(opened.openedOffline).toBe(true);
  expect(opened.openedAt).toBe(pressedAt);

  // Повтор той же досылки (обрыв после доставки) → та же смена, дубля нет.
  r = await driver.request.post(`/api/my/shift`, { data: { op: "open" }, headers });
  expect(((await r.json()).data as { id: string }).id).toBe(opened.id);
  const shifts = (await (await milena.request.get(`/api/shifts?date=${today}`)).json()).data as {
    id: string;
    openedOffline: boolean;
  }[];
  expect(shifts.length).toBe(1);
  expect(shifts[0].openedOffline).toBe(true);

  // FIFO-цепочка утра: после open проходит взятие в работу (SHIFT_REQUIRED нет) — тоже с досылочными
  // заголовками, повтор не двоит.
  const trKey = crypto.randomUUID();
  r = await driver.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
    headers: { "Idempotency-Key": trKey, "X-Occurred-At": new Date(Date.now() - 4 * 60_000).toISOString() },
  });
  expect(r.status()).toBe(200);
  r = await driver.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
    headers: { "Idempotency-Key": trKey },
  });
  expect(r.status()).toBe(200); // повтор отдаёт сохранённый результат, не падает на матрице статусов

  // Милена видит пометку на доске: «офлайн (время телефона)» в блоке подтверждения смен.
  await milena.goto("/board");
  await expect(milena.getByText("офлайн (время телефона)").first()).toBeVisible();

  // Прибираемся.
  await driver.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "DONE" } });

  await mctx.close();
  await dctx.close();
});
