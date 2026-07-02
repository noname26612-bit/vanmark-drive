// Сводка v2 (решение Артёма 02.07): занятость/план-факт/пометки/деньги + drill-down.
// Рублёвая цена простоя — только админу (№10): у диспетчера null и подпись «для администратора».
// Общая dev-БД: числовые ассерты «не меньше», строчные — по уникальным заголовкам.
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

async function kashId(milena: Page): Promise<string> {
  const period = today.slice(0, 7);
  const ov = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  return ov.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский").driverId;
}

test("сводка v2: метрики, деньги по ролям, drill-down и CSV", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");

  // Данные: DONE-задача сегодня (ведёт диспетчер) + пометка о простое 45 мин.
  const title = `e2e summary-v2 ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e summary-v2");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Каширский" });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  for (const toStatus of ["IN_PROGRESS", "DONE"]) {
    expect((await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus } })).status()).toBe(200);
  }
  const driverId = await kashId(milena);
  const idleReason = `e2e v2 idle ${Date.now()}`;
  expect(
    (
      await milena.request.post("/api/idle-notes", {
        data: { driverId, date: today, minutes: 45, note: idleReason },
      })
    ).status(),
  ).toBe(201);

  // Overview диспетчера: новые метрики есть, старой разбивки по типам нет, рубли простоя скрыты.
  const ovM = (await (
    await milena.request.get(`/api/summary/overview?granularity=day&date=${today}`)
  ).json()).data;
  expect(ovM.payrollVisible).toBe(false);
  expect(ovM.money.idleCost).toBeNull();
  expect(typeof ovM.money.receivedTotal).toBe("number");
  const kashM = ovM.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");
  expect(kashM.doneCount).toBeGreaterThanOrEqual(1);
  expect(kashM.idleNotedMinutes).toBeGreaterThanOrEqual(45);
  expect(kashM).toHaveProperty("loadPercent");
  expect(kashM).toHaveProperty("days");
  expect(kashM).not.toHaveProperty("repairCount"); // разбивка по типам убрана (02.07)
  expect(kashM).not.toHaveProperty("byType");

  // Overview админа: рублёвая цена простоя присутствует (числа, не null).
  const ovA = (await (
    await artem.request.get(`/api/summary/overview?granularity=day&date=${today}`)
  ).json()).data;
  expect(ovA.payrollVisible).toBe(true);
  expect(typeof ovA.money.idleCost).toBe("number");
  expect(typeof ovA.money.idleNotedCost).toBe("number");

  // Drill-down: done содержит нашу задачу; idle-notes — нашу причину; неизвестная метрика — 422.
  const done = (await (
    await milena.request.get(`/api/summary/details?metric=done&granularity=day&date=${today}&driverId=${driverId}`)
  ).json()).data;
  expect(done.some((r: { title: string }) => r.title === title)).toBe(true);
  const idle = (await (
    await milena.request.get(`/api/summary/details?metric=idle-notes&granularity=day&date=${today}`)
  ).json()).data;
  expect(idle.some((r: { title: string }) => r.title === idleReason)).toBe(true);
  expect(
    (await milena.request.get(`/api/summary/details?metric=hack&granularity=day&date=${today}`)).status(),
  ).toBe(422);

  // CSV: у диспетчера НЕТ рублёвой колонки, у админа — есть; «Ремонты» исчезли, новые колонки на месте.
  const csvM = await (await milena.request.get(`/api/summary/export?granularity=day&date=${today}`)).text();
  expect(csvM).toContain("Загрузка, %");
  expect(csvM).toContain("Простой (пометки), мин");
  expect(csvM).not.toContain("Ремонты");
  expect(csvM).not.toContain("Цена простоя");
  const csvA = await (await artem.request.get(`/api/summary/export?granularity=day&date=${today}`)).text();
  expect(csvA).toContain("Цена простоя, ₽");

  // UI диспетчера: подпись «для администратора» вместо рублей; клик по «выполнено» раскрывает список.
  await milena.goto("/summary");
  await milena.getByRole("button", { name: "День" }).click();
  await expect(milena.getByText("— для администратора")).toBeVisible();
  const kashCard = milena.locator("div.rounded-xl", { hasText: "Алексей Каширский" }).first();
  await kashCard.getByRole("button", { name: /выполнено/ }).click();
  await expect(milena.getByRole("link", { name: new RegExp(title) })).toBeVisible({ timeout: 10_000 });

  // Изоляция: details под водителем закрыт.
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect(
    (await driver.request.get(`/api/summary/details?metric=done&granularity=day&date=${today}`)).status(),
  ).toBe(403);

  await mctx.close();
  await actx.close();
  await dctx.close();
});
