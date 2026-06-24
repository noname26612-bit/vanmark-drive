import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

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
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.getByText("Назначена").first()).toBeVisible();
  return { id, title };
}

test("офлайн: смена статуса копится в очереди и досылается при возврате связи", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id, title } = await createAssignedTask(milena, "Алексей Каширский", "Сдача в ТК");

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  await driver.goto("/m");
  await driver.getByText(title).click(); // карточку открываем онлайн (в dev нет SW-precache офлайн)
  await driver.waitForURL(/\/m\/[0-9a-f-]+$/);
  await expect(driver.getByText("Назначена").first()).toBeVisible();

  // Уходим в офлайн и берём задачу в работу.
  await dctx.setOffline(true);
  await driver.getByRole("button", { name: "В работу" }).click();

  // Оверлей: статус оптимистично «В работе» + индикатор «Не отправлено».
  await expect(driver.getByText("В работе").first()).toBeVisible();
  await expect(driver.getByText(/Не отправлено/)).toBeVisible();

  // На сервере действие ещё НЕ применилось (офлайн) — статус остаётся «Назначена».
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
