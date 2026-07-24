import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Гасим зависшие IN_PROGRESS перед каждым тестом (правило «одна активная задача»).
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

// Диспетчер создаёт задачу через UI (без обязательных контактов — их сняли 24.07). Возвращает id.
async function createTask(
  milena: Page,
  typeLabel: string,
  opts: { title: string; date?: string },
): Promise<string> {
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(opts.title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e status");
  if (opts.date) {
    await milena.locator('[data-testid="create-date"]').fill(opts.date);
    await milena.locator('[data-testid="create-date"]').press("Enter");
  }
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByTestId("task-search").fill(opts.title);
  await milena.getByRole("link", { name: opts.title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  return milena.url().split("/tasks/")[1];
}

// П.3: назначение ПРОСРОЧЕННОЙ задачи переносит её на сегодня и оставляет след в истории.
// (Эквивалент перетаскивания карточки из «Требуют внимания» на водителя — тот же op:assign.)
test("просроченная задача при назначении переезжает на сегодня + событие в истории", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const title = `e2e overdue ${Date.now()}`;
  const id = await createTask(milena, "Сдача / забор из ТК", { title, date: yesterday });

  // Назначаем водителя из карточки — просроченная дата должна стать сегодняшней.
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Каширский" });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");

  const d = (await (await milena.request.get(`/api/tasks/${id}`)).json()).data;
  expect(String(d.scheduledDate).slice(0, 10)).toBe(today);
  const events = d.events as Array<{ kind: string; comment: string | null }>;
  expect(
    events.some((e) => e.kind === "auto_date" && (e.comment ?? "").toLowerCase().includes("просрочен")),
  ).toBe(true);

  await mctx.close();
});

// П.4: диспетчер свободно меняет статус, включая откат ошибочного «Завершено» (кейс №700).
test("свободная смена статуса диспетчером: откат завершённой снимает отметку завершения (№700)", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const title = `e2e rollback ${Date.now()}`;
  const id = await createTask(milena, "Сдача / забор из ТК", { title });
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Каширский" });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");

  // Милена ведёт статусы за исполнителя: в работу → завершить.
  await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } });
  await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "DONE" } });
  let d = (await (await milena.request.get(`/api/tasks/${id}`)).json()).data;
  expect(d.status).toBe("DONE");
  expect(d.completedAt).not.toBeNull();

  // Откат из терминального БЕЗ причины — отказ (причина обязательна для аудита).
  const noReason = await milena.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "ASSIGNED" },
  });
  expect(noReason.ok()).toBeFalsy();

  // Откат «Завершена → Отменена» с причиной (по факту заявка отменилась) → completedAt снят.
  const rollback = await milena.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "CANCELLED", reason: "водитель ошибочно завершил — по факту отмена (№700)" },
  });
  expect(rollback.ok()).toBeTruthy();
  d = (await (await milena.request.get(`/api/tasks/${id}`)).json()).data;
  expect(d.status).toBe("CANCELLED");
  expect(d.completedAt).toBeNull();

  await mctx.close();
});

// П.4 (UI): модалка «Изменить статус» переводит задачу с причиной.
test("карточка: «Изменить статус» переводит задачу (с причиной)", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  const title = `e2e status-ui ${Date.now()}`;
  await createTask(page, "Сдача / забор из ТК", { title });

  await page.getByRole("button", { name: "Изменить статус" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("status-target")).toBeVisible();
  await dialog.getByTestId("status-target").selectOption("CANCELLED");
  await dialog.getByPlaceholder(/ошибочно завершил/).fill("тест смены статуса из UI");
  await dialog.getByTestId("status-apply").click();

  // Задача стала «Отменена» — бейдж статуса виден на карточке.
  await expect(page.getByText("Отменена").first()).toBeVisible();
});
