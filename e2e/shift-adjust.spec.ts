import { test, expect, type Page } from "@playwright/test";
import { resetShifts } from "./reset";

// Этап C: №3 — правка времени открытия смены диспетчером/админом (при подтверждении и задним числом),
// аудит и пересчёт штрафа «поздно открыл смену». №5 — данные для полосы смен на «Сегодня».
test.beforeEach(resetShifts);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
// МСК-день: сервер считает день смены в МСК; UTC-дата около полуночи «уедет» на день.
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
const period = today.slice(0, 7);

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

test("№3: правка времени при подтверждении и задним числом + аудит", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);
  const originalOpenedAt = opened.openedAt;

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Подтверждение с правкой времени (на случай «не было связи»).
  const conf = await milena.request.post(`/api/shifts/${opened.id}/confirm`, {
    data: { openedAtTime: "07:30", reason: "не было связи" },
  });
  expect(conf.status()).toBe(200);
  const c = (await conf.json()).data;
  expect(c.status).toBe("OPEN");
  expect(c.openedAtReported).toBe(originalOpenedAt); // исходное время сохранено
  expect(c.openedAtAdjustNote).toBe("не было связи");
  expect(c.openedAt).not.toBe(originalOpenedAt); // актуальное время изменилось

  // Правка задним числом (PATCH) для уже подтверждённой смены.
  const patch = await milena.request.patch(`/api/shifts/${opened.id}`, {
    data: { openedAtTime: "08:45", reason: "уточнение по табелю" },
  });
  expect(patch.status()).toBe(200);
  const p = (await patch.json()).data;
  expect(p.openedAtAdjustNote).toBe("уточнение по табелю");
  expect(p.openedAtReported).toBe(originalOpenedAt); // исходное НЕ перетирается повторной правкой

  await dctx.close();
  await mctx.close();
});

test("№3: правка времени пересчитывает штраф «поздно открыл смену»", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");

  const hasShiftLate = async (): Promise<boolean> => {
    const ov = (await (await artem.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
    return (ov.candidates as Array<{ driverId: string; kind: string }>).some(
      (c) => c.driverId === opened.driverId && c.kind === "SHIFT_LATE",
    );
  };

  // Подтверждаем поздним временем (11:00 > порога 9:15) → штраф появляется.
  await milena.request.post(`/api/shifts/${opened.id}/confirm`, { data: { openedAtTime: "11:00", reason: "поздно" } });
  expect(await hasShiftLate()).toBe(true);

  // Правим на раннее (08:00 < порога) → штраф уходит сам.
  await milena.request.patch(`/api/shifts/${opened.id}`, { data: { openedAtTime: "08:00", reason: "исправление" } });
  expect(await hasShiftLate()).toBe(false);

  await dctx.close();
  await mctx.close();
  await actx.close();
});

test("№3: правка времени — только Д/А; причина обязательна", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  const opened = await openShift(driver);

  // Водителю правка времени недоступна (диспетчерская ручка → 403).
  const denied = await driver.request.patch(`/api/shifts/${opened.id}`, {
    data: { openedAtTime: "08:00", reason: "x" },
  });
  expect(denied.status()).toBe(403);

  // Диспетчер: правка без причины отклоняется.
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const noReason = await milena.request.patch(`/api/shifts/${opened.id}`, { data: { openedAtTime: "08:00" } });
  expect([400, 422]).toContain(noReason.status());

  await dctx.close();
  await mctx.close();
});

test("№5: смены на «Сегодня» — workedMinutes в API и блок на доске", async ({ browser }) => {
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await openShift(driver);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // API смен за день несёт workedMinutes (для полосы «в работе/простой»).
  const list = (await (await milena.request.get(`/api/shifts?date=${today}`)).json()).data as Array<{
    driverId: string;
    workedMinutes?: number;
  }>;
  const mine = list.find((s) => s.driverId === undefined ? false : true);
  expect(mine).toBeTruthy();
  expect(typeof mine!.workedMinutes).toBe("number");

  // Блок «Смены водителей» виден на доске.
  await milena.goto("/board");
  await expect(milena.getByTestId("shift-workload")).toBeVisible();

  await dctx.close();
  await mctx.close();
});
