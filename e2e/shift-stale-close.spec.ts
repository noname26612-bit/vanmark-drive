// Зависшие смены (03.08): водитель забыл закрыть смену, день прошёл. Раньше до такой смены нельзя
// было добраться из интерфейса — доска показывает только сегодняшний день, а в «Истории смен» была
// лишь правка времени уже закрытой смены. Теперь диспетчер/директор/админ закрывает её вручную,
// указывая дату и время.
import { test, expect, type Page } from "@playwright/test";
import { resetShifts, insertStaleShift } from "./reset";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Дата N дней назад по МСК в формате YYYY-MM-DD (как считает день смены сервер). */
function moscowDaysAgo(days: number): string {
  const msk = new Date(Date.now() + 3 * 3_600_000 - days * 86_400_000);
  return msk.toISOString().slice(0, 10);
}

test.beforeEach(resetShifts);

test("диспетчер видит зависшую смену и закрывает её с датой и временем", async ({ page }) => {
  const shiftId = await insertStaleShift("kashirskiy", 2);
  const shiftDate = moscowDaysAgo(2);
  await login(page, "milena");

  // Смена попадает в список зависших.
  const list = await page.request.get("/api/shifts/stale");
  expect(list.status()).toBe(200);
  const body = (await list.json()) as { data: { id: string; date: string }[] };
  expect(body.data.some((s) => s.id === shiftId)).toBe(true);

  // Закрываем указанной датой и временем с причиной.
  const res = await page.request.patch(`/api/shifts/${shiftId}`, {
    data: {
      op: "close",
      closedAtDate: shiftDate,
      closedAtTime: "18:00",
      reason: "водитель забыл закрыть",
    },
  });
  expect(res.status()).toBe(200);
  const closed = (await res.json()) as {
    data: { status: string; closedAt: string; closedById: string | null; closedAtAdjustNote: string | null };
  };
  expect(closed.data.status).toBe("CLOSED");
  expect(closed.data.closedAt).toContain(`${shiftDate}T15:00`); // 18:00 МСК = 15:00 UTC
  expect(closed.data.closedById).not.toBeNull();
  expect(closed.data.closedAtAdjustNote).toBe("водитель забыл закрыть");

  // Закрытая смена уходит из списка зависших.
  const after = (await (await page.request.get("/api/shifts/stale")).json()) as {
    data: { id: string }[];
  };
  expect(after.data.some((s) => s.id === shiftId)).toBe(false);
});

test("смена через полночь: закрытие датой следующего дня", async ({ page }) => {
  const shiftId = await insertStaleShift("pisarev", 2);
  const nextDay = moscowDaysAgo(1);
  await login(page, "milena");

  const res = await page.request.patch(`/api/shifts/${shiftId}`, {
    data: { op: "close", closedAtDate: nextDay, closedAtTime: "02:15", reason: "смена через полночь" },
  });
  expect(res.status()).toBe(200);
  const closed = (await res.json()) as { data: { closedAt: string } };
  // 02:15 МСК = 23:15 UTC предыдущего дня
  expect(closed.data.closedAt).toContain(`${moscowDaysAgo(2)}T23:15`);
});

test("отказы: дата без причины, дата без времени, опечатка в дате", async ({ page }) => {
  const shiftId = await insertStaleShift("kashirskiy", 2);
  const shiftDate = moscowDaysAgo(2);
  await login(page, "milena");

  // Дата отличается от дня смены, причины нет.
  const noReason = await page.request.patch(`/api/shifts/${shiftId}`, {
    data: { op: "close", closedAtDate: moscowDaysAgo(1), closedAtTime: "10:00" },
  });
  expect([400, 422]).toContain(noReason.status());

  // Дата без времени.
  const noTime = await page.request.patch(`/api/shifts/${shiftId}`, {
    data: { op: "close", closedAtDate: shiftDate, reason: "закрыть" },
  });
  expect([400, 422]).toContain(noTime.status());

  // Опечатка в дате: смена получается длиннее суток.
  const tooLong = await page.request.patch(`/api/shifts/${shiftId}`, {
    data: { op: "close", closedAtDate: moscowDaysAgo(-2), closedAtTime: "18:00", reason: "опечатка" },
  });
  expect([400, 422]).toContain(tooLong.status());

  // Кривой формат даты.
  const badFormat = await page.request.patch(`/api/shifts/${shiftId}`, {
    data: { op: "close", closedAtDate: "31.07.2026", closedAtTime: "18:00", reason: "формат" },
  });
  expect([400, 422]).toContain(badFormat.status());

  // Смена по-прежнему открыта — ни один отказ её не закрыл.
  const still = (await (await page.request.get("/api/shifts/stale")).json()) as { data: { id: string }[] };
  expect(still.data.some((s) => s.id === shiftId)).toBe(true);
});

test("изоляция: водителю список зависших смен недоступен", async ({ page }) => {
  await insertStaleShift("kashirskiy", 2);
  await login(page, "kashirskiy");
  const res = await page.request.get("/api/shifts/stale");
  expect(res.status()).toBe(403);
});

test("доска: баннер зависших смен, закрытие через панель", async ({ page }) => {
  test.slow();
  await insertStaleShift("kashirskiy", 3);
  const shiftDate = moscowDaysAgo(3);
  await login(page, "milena");

  await page.goto("/board");
  const block = page.getByTestId("stale-shifts-block");
  await expect(block).toBeVisible();
  await expect(block).toContainText("Незакрытые смены прошлых дней");
  const row = block.getByTestId("stale-shift-row").filter({ hasText: "Алексей Каширский" });
  await expect(row).toBeVisible();

  await row.getByTestId("stale-shift-close").click();
  const panel = page.getByTestId("shift-close-panel");
  await expect(panel).toBeVisible();
  // Дата подставлена днём смены; вводим время и причину.
  await panel.getByTestId("shift-close-time").fill("19:30");
  await panel.getByTestId("shift-close-reason").fill("забыл закрыть, уточнили по телефону");
  // Живой расчёт длительности не даёт ошибиться с датой.
  await expect(panel.getByTestId("shift-close-span")).toContainText("Смена получится");
  await panel.getByTestId("shift-close-save").click();

  // Строка ушла из баннера (или исчез весь баннер).
  await expect(row).toBeHidden();

  // Смена действительно закрыта нужным временем.
  const history = (await (
    await page.request.get(`/api/summary/shifts?granularity=month&date=${shiftDate.slice(0, 8)}01`)
  ).json()) as { data: { dateKey: string; closedAt: string | null; driverName: string }[] };
  const closedRow = history.data.find((r) => r.dateKey === shiftDate && r.driverName === "Алексей Каширский");
  expect(closedRow?.closedAt).toContain(`${shiftDate}T16:30`); // 19:30 МСК
});

test("история смен: кнопка «Закрыть смену» у незакрытой строки", async ({ page }) => {
  test.slow();
  // «История смен» в KPI показывает текущий месяц, поэтому берём вчерашнюю смену. Первого числа
  // вчера — это прошлый месяц: такой прогон пропускаем (проверка баннера на доске от даты не зависит).
  test.skip(Number(moscowDaysAgo(0).slice(8)) < 2, "первого числа вчерашняя смена вне текущего месяца");
  await insertStaleShift("pisarev", 1);
  const shiftDate = moscowDaysAgo(1);
  await login(page, "milena");

  await page.goto("/kpi");
  const history = page.getByTestId("shift-history");
  await expect(history).toBeVisible();
  await history.getByTestId("shift-history-driver").selectOption({ label: "Алексей Писарев" });

  const item = history.locator("li").filter({ hasText: "не закрыта" }).first();
  await expect(item).toBeVisible();
  await item.getByTestId("shift-history-close").click();

  const panel = page.getByTestId("shift-close-panel");
  await panel.getByTestId("shift-close-time").fill("20:00");
  await panel.getByTestId("shift-close-reason").fill("закрыто задним числом");
  await panel.getByTestId("shift-close-save").click();

  await expect(history.locator("li").filter({ hasText: `Закрыта 20:00` }).first()).toBeVisible({
    timeout: 10_000,
  });
  expect(shiftDate).toBeTruthy();
});
