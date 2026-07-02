// Пометки диспетчера о простое (решение Артёма 02.07): внесение с доски, штраф из пометки,
// невидимость для водителя. Общая dev-БД: ассерты — по уникальным признакам своей пометки.
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

test("пометка о простое: внесение, штраф с автотекстом без причины, водителю не видна", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Уникальная причина — чтобы не путаться с пометками прошлых прогонов в общей dev-БД.
  const reason = `e2e idle ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

  // Неизвестный водитель — валидация.
  const created = await milena.request.post("/api/idle-notes", {
    data: { driverId: "unknown", date: today, minutes: 90, note: reason },
  });
  expect(created.status()).toBe(422);

  // Настоящий id Каширского — через KPI overview (диспетчеру доступен).
  const period = today.slice(0, 7);
  const ov = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  const kash = ov.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");
  expect(kash).toBeTruthy();

  const note = (
    await (
      await milena.request.post("/api/idle-notes", {
        data: { driverId: kash.driverId, date: today, minutes: 90, note: reason },
      })
    ).json()
  ).data;
  expect(note.minutes).toBe(90);
  expect(note.kpiMarkId).toBeNull();

  // Валидация минут: 0 и 1000 — отказ.
  expect(
    (
      await milena.request.post("/api/idle-notes", {
        data: { driverId: kash.driverId, date: today, minutes: 0 },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await milena.request.post("/api/idle-notes", {
        data: { driverId: kash.driverId, date: today, minutes: 1000 },
      })
    ).status(),
  ).toBe(422);

  // Пометка видна на доске: метка «Пометка: …» в блоке смен.
  await milena.goto("/board");
  await expect(milena.getByRole("button", { name: /Пометка: / }).first()).toBeVisible();

  // Штраф из пометки: 500 ₽. Note штрафа — автотекст «Простой ДД.ММ, 90 мин» БЕЗ причины Милены.
  const fined = (
    await (
      await milena.request.post(`/api/idle-notes/${note.id}/fine`, { data: { amount: 500 } })
    ).json()
  ).data;
  expect(fined.kpiMarkId).toBeTruthy();

  const ov2 = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  const kash2 = ov2.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");
  const mark = kash2.marks.find((m: { id: string }) => m.id === fined.kpiMarkId);
  expect(mark).toBeTruthy();
  expect(mark.kind).toBe("MANUAL");
  expect(mark.manualAmount).toBe(-500);
  expect(mark.note).toContain("Простой");
  expect(mark.note).toContain("90 мин");
  expect(mark.note).not.toContain(reason); // причина Милены в note штрафа НЕ утекает

  // Повторный штраф и удаление оштрафованной — отказ.
  expect(
    (await milena.request.post(`/api/idle-notes/${note.id}/fine`, { data: { amount: 100 } })).status(),
  ).toBe(422);
  expect((await milena.request.delete(`/api/idle-notes/${note.id}`)).status()).toBe(422);

  // Водитель: пометки недоступны (403), в его расчёте штраф есть, а причины Милены нет нигде.
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await driver.request.get(`/api/idle-notes?from=${today}&to=${today}`)).status()).toBe(403);
  expect(
    (await driver.request.post("/api/idle-notes", { data: { driverId: kash.driverId, date: today, minutes: 5 } })).status(),
  ).toBe(403);
  const my = (await (await driver.request.get(`/api/my/kpi?period=${period}`)).json()).data;
  const myMark = my.marks.find((m: { id: string }) => m.id === fined.kpiMarkId);
  expect(myMark).toBeTruthy(); // штраф водитель видит…
  expect(JSON.stringify(my)).not.toContain(reason); // …а причину/пометку — нет

  await mctx.close();
  await dctx.close();
});

test("модалка простоя на доске: внесение и удаление через UI", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const reason = `e2e idle-ui ${Date.now()}`;

  await milena.goto("/board");
  // Кнопка «Простой» в первой строке блока смен.
  await milena
    .locator('[data-testid="shift-workload"]')
    .getByRole("button", { name: "Простой", exact: true })
    .first()
    .click();
  await milena.locator('[data-testid="idle-minutes"]').fill("45");
  await milena.locator('[data-testid="idle-note"]').fill(reason);
  await milena.locator('[data-testid="idle-save"]').click();
  // Пометка появилась в списке модалки; удаляем её же (наша строка — по уникальной причине).
  const row = milena.locator("li", { hasText: reason });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Удалить" }).click();
  await expect(milena.locator("li", { hasText: reason })).toHaveCount(0);

  await mctx.close();
});
