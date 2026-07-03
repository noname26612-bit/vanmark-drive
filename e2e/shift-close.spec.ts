import { test, expect, type Page } from "@playwright/test";
import { resetShifts } from "./reset";

// №2: закрытие смены водителя диспетчером/директором/админом. №3: правка времени закрытия + история
// смен в «Сводке». Изоляция: диспетчерские ручки водителю недоступны (403).
test.beforeEach(resetShifts);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
// День смены сервер считает в МСК; берём МСК-дату, иначе около полуночи UTC-дата разойдётся с Shift.date
// (тогда ручное время закрытия и окно истории смен «уедут» на день).
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function openShift(driver: Page): Promise<{ id: string; openedAt: string; driverId: string }> {
  const r = await driver.request.post(`/api/my/shift`, { data: { op: "open", today } });
  expect(r.status()).toBe(200);
  return (await r.json()).data;
}

test("№2: диспетчер закрывает смену водителя — CLOSED + closedById, идемпотентно", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const close = await milena.request.patch(`/api/shifts/${opened.id}`, { data: { op: "close" } });
  expect(close.status()).toBe(200);
  const c = (await close.json()).data;
  expect(c.status).toBe("CLOSED");
  expect(c.closedById).toBeTruthy();
  expect(c.closedAt).not.toBeNull();

  // Повторно — идемпотентно (остаётся CLOSED).
  const again = await milena.request.patch(`/api/shifts/${opened.id}`, { data: { op: "close" } });
  expect(again.status()).toBe(200);
  expect((await again.json()).data.status).toBe("CLOSED");

  await dctx.close();
  await mctx.close();
});

test("№2: закрытие с ручным временем и причиной пишет аудит", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const close = await milena.request.patch(`/api/shifts/${opened.id}`, {
    data: { op: "close", closedAtTime: "20:15", reason: "водитель забыл закрыть" },
  });
  expect(close.status()).toBe(200);
  const c = (await close.json()).data;
  expect(c.status).toBe("CLOSED");
  expect(c.closedAtAdjustNote).toBe("водитель забыл закрыть");
  expect(c.closedAt).toContain(`${today}T17:15`); // 20:15 МСК = 17:15 UTC

  await dctx.close();
  await mctx.close();
});

test("№3: правка времени закрытия — reported, обязательная причина, только закрытую смену", async ({
  browser,
}) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Открытую смену править закрытие нельзя.
  const notClosed = await milena.request.patch(`/api/shifts/${opened.id}`, {
    data: { closedAtTime: "19:00", reason: "рано" },
  });
  expect([400, 422]).toContain(notClosed.status());

  // Закрываем, затем правим время закрытия.
  await milena.request.patch(`/api/shifts/${opened.id}`, { data: { op: "close" } });
  const adj = await milena.request.patch(`/api/shifts/${opened.id}`, {
    data: { closedAtTime: "19:00", reason: "по факту позже" },
  });
  expect(adj.status()).toBe(200);
  const a = (await adj.json()).data;
  expect(a.closedAtAdjustNote).toBe("по факту позже");
  expect(a.closedAtReported).not.toBeNull(); // исходное время закрытия сохранено
  expect(a.closedAt).toContain(`${today}T16:00`); // 19:00 МСК = 16:00 UTC

  // Без причины — отказ.
  const noReason = await milena.request.patch(`/api/shifts/${opened.id}`, { data: { closedAtTime: "18:00" } });
  expect([400, 422]).toContain(noReason.status());

  await dctx.close();
  await mctx.close();
});

test("изоляция: водителю недоступны закрытие чужой смены и история смен (403)", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  // Диспетчерская ручка закрытия по shiftId — водителю 403.
  const denyClose = await driver.request.patch(`/api/shifts/${opened.id}`, { data: { op: "close" } });
  expect(denyClose.status()).toBe(403);

  // История смен — только Д/А.
  const denyHist = await driver.request.get(`/api/summary/shifts?granularity=day&date=${today}`);
  expect(denyHist.status()).toBe(403);

  await dctx.close();
});

test("№3: история смен в Сводке — эндпоинт несёт смену; секция и правка видны", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  await milena.request.patch(`/api/shifts/${opened.id}`, { data: { op: "close" } });

  // Эндпоинт истории отдаёт закрытую смену водителя.
  const hist = (await (
    await milena.request.get(`/api/summary/shifts?granularity=day&date=${today}`)
  ).json()).data as Array<{ id: string; status: string; closedAt: string | null }>;
  const mine = hist.find((s) => s.id === opened.id);
  expect(mine).toBeTruthy();
  expect(mine!.status).toBe("CLOSED");
  expect(mine!.closedAt).not.toBeNull();

  // Секция «История смен» видна на экране Сводки.
  await milena.goto("/summary");
  await expect(milena.getByTestId("shift-history")).toBeVisible();

  await dctx.close();
  await mctx.close();
});

test("№2 UI: кнопка «Закрыть смену» на доске закрывает смену", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  await milena.goto("/board");

  const workload = milena.getByTestId("shift-workload");
  await expect(workload).toBeVisible();

  // Единственная открытая смена (resetShifts очистил остальные) → одна кнопка «Закрыть».
  await workload.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(milena.getByTestId("shift-close-panel")).toBeVisible();
  await milena.getByTestId("shift-close-now").click();

  await expect(workload.getByText("Закрыта", { exact: true })).toBeVisible();

  await dctx.close();
  await mctx.close();
});
