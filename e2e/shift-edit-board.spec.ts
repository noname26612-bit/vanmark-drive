import { test, expect, type Page } from "@playwright/test";
import { resetShifts } from "./reset";

// №1 (04.07): правка времени смены прямо с доски «Сегодня» — кнопка «Изменить» в плашке «Смены
// водителей» открывает панель правки открытия/закрытия (тот же PATCH, что в «Истории смен»).
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

async function openShift(driver: Page): Promise<{ id: string; openedAt: string }> {
  const r = await driver.request.post(`/api/my/shift`, { data: { op: "open", today } });
  expect(r.status()).toBe(200);
  return (await r.json()).data;
}

test("№1: диспетчер правит время открытия смены с доски", async ({ browser }) => {
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

  // Единственная открытая смена (resetShifts очистил остальные) → одна кнопка «Изменить».
  await workload.getByRole("button", { name: "Изменить" }).click();
  await expect(milena.getByTestId("shift-edit-panel")).toBeVisible();

  await milena.getByTestId("shift-edit-time").fill("07:45");
  await milena.getByTestId("shift-edit-reason").fill("правка с доски");
  await milena.getByTestId("shift-edit-save").click();

  // Панель закрылась, правка ушла на сервер.
  await expect(milena.getByTestId("shift-edit-panel")).toHaveCount(0);
  const list = (await (await milena.request.get(`/api/shifts?date=${today}`)).json()).data as Array<{
    id: string;
    openedAtAdjustNote: string | null;
    openedAtReported: string | null;
  }>;
  const mine = list.find((s) => s.id === opened.id);
  expect(mine?.openedAtAdjustNote).toBe("правка с доски");
  expect(mine?.openedAtReported).toBe(opened.openedAt); // исходное время сохранено

  // Без причины сохранить нельзя.
  await workload.getByRole("button", { name: "Изменить" }).click();
  await milena.getByTestId("shift-edit-time").fill("08:00");
  await milena.getByTestId("shift-edit-save").click();
  await expect(milena.getByTestId("shift-edit-panel")).toBeVisible(); // осталась открытой — причина обязательна

  await dctx.close();
  await mctx.close();
});
