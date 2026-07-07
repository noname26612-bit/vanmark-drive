import { test, expect, type Page } from "@playwright/test";
import { resetShifts } from "./reset";

// Коррекция авто-простоя смены с доски «Сегодня» (07.07): полоса «В работе / Простой» считается
// автоматически; если водитель работал, но не отметил задачу (сел телефон), диспетчер задаёт
// фактический простой вручную. Кнопка «Поправить» у полосы → панель ввода (ч+мин, причина).
test.beforeEach(resetShifts);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function openShift(driver: Page): Promise<{ id: string }> {
  const r = await driver.request.post(`/api/my/shift`, { data: { op: "open", today } });
  expect(r.status()).toBe(200);
  return (await r.json()).data;
}

async function fetchShift(milena: Page, id: string) {
  const list = (await (await milena.request.get(`/api/shifts?date=${today}`)).json()).data as Array<{
    id: string;
    idleMinutesOverride: number | null;
    idleOverrideNote: string | null;
  }>;
  return list.find((s) => s.id === id);
}

test("диспетчер задаёт фактический простой и возвращает авто-расчёт", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  await milena.goto("/board");

  const workload = milena.getByTestId("shift-workload");
  await expect(workload).toBeVisible();

  // Открываем панель коррекции, ставим «Простоя не было» (0), причина, сохраняем.
  await milena.getByTestId("shift-idle-edit").click();
  await expect(milena.getByTestId("shift-idle-panel")).toBeVisible();
  await milena.getByTestId("shift-idle-zero").click();
  await milena.getByTestId("shift-idle-reason").fill("сел телефон, водитель работал");
  await milena.getByTestId("shift-idle-save").click();

  await expect(milena.getByTestId("shift-idle-panel")).toHaveCount(0);
  let mine = await fetchShift(milena, opened.id);
  expect(mine?.idleMinutesOverride).toBe(0);
  expect(mine?.idleOverrideNote).toBe("сел телефон, водитель работал");

  // Пометка «Простой задан вручную» видна в строке.
  await expect(workload.getByText("Простой задан вручную", { exact: false })).toBeVisible();

  // Возврат к авто-расчёту — override снимается.
  await milena.getByTestId("shift-idle-edit").click();
  await milena.getByTestId("shift-idle-reset").click();
  await expect(milena.getByTestId("shift-idle-panel")).toHaveCount(0);
  mine = await fetchShift(milena, opened.id);
  expect(mine?.idleMinutesOverride).toBeNull();

  // Задать значение без причины нельзя — панель остаётся открытой.
  await milena.getByTestId("shift-idle-edit").click();
  await milena.getByTestId("shift-idle-hours").fill("1");
  await milena.getByTestId("shift-idle-save").click();
  await expect(milena.getByTestId("shift-idle-panel")).toBeVisible();

  await dctx.close();
  await mctx.close();
});

test("простой водителю не отдаётся (изоляция): override и причина скрыты в /api/my/shift", async ({
  browser,
}) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Диспетчер ставит коррекцию через API.
  const patch = await milena.request.patch(`/api/shifts/${opened.id}`, {
    data: { op: "idle", idleMinutes: 30, reason: "секретная причина офиса" },
  });
  expect(patch.status()).toBe(200);

  // В ответе водителю поля коррекции обнулены (причина не утекает).
  const mine = (await (await driver.request.get(`/api/my/shift?date=${today}`)).json()).data as {
    idleMinutesOverride: number | null;
    idleOverrideNote: string | null;
  };
  expect(mine.idleMinutesOverride).toBeNull();
  expect(mine.idleOverrideNote).toBeNull();

  await dctx.close();
  await mctx.close();
});
