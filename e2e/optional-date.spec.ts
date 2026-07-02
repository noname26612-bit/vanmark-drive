import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// п.1: задача создаётся без даты («Не указывать дату») → попадает в пул «Без даты»;
// при назначении водителя сервер сам ставит сегодняшнюю дату и пишет событие в журнал.
test("дата опциональна: создание без даты → назначение проставляет сегодня", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  await page.goto("/board");
  await expect(page.getByTestId("board")).toBeVisible();

  const title = `Без даты ${Date.now()}`;

  // Создаём задачу с включённым «Не указывать дату».
  await page.getByRole("button", { name: "Задача" }).click();
  await page.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await page.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес без даты 1");
  await page.locator('[data-testid="create-org"]').fill("ООО Тест");
  await page.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await page.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await page.getByTestId("create-no-date").check();
  await expect(page.getByTestId("create-date")).toBeDisabled();
  await page.getByRole("button", { name: "Создать", exact: true }).click();

  // Карточка появилась в колонке «Без даты».
  const undated = page.getByTestId("col-undated");
  const cardInUndated = undated.locator('[data-testid="board-card"]').filter({ hasText: title });
  await expect(cardInUndated).toBeVisible();

  // Проверяем через API, что задача действительно без даты.
  const listRes = await page.request.get(`/api/tasks?q=${encodeURIComponent(title)}`);
  const taskId: string = (await listRes.json()).data[0].id;
  const before = (await (await page.request.get(`/api/tasks/${taskId}`)).json()).data;
  expect(before.scheduledDate).toBeNull();

  // Назначаем водителя из выпадающего списка прямо на карточке (quickAssign).
  await cardInUndated.locator("select").selectOption({ label: "Алексей Каширский" });

  // Карточка ушла из «Без даты» (значит дата проставилась) и появилась в колонке водителя.
  await expect(undated.locator('[data-testid="board-card"]').filter({ hasText: title })).toHaveCount(0);
  await expect(
    page.locator('[data-testid^="col-driver-"] [data-testid="board-card"]').filter({ hasText: title }),
  ).toBeVisible();

  // API: дата теперь стоит, в журнале есть событие авто-простановки даты.
  const after = (await (await page.request.get(`/api/tasks/${taskId}`)).json()).data;
  expect(after.scheduledDate).not.toBeNull();
  expect(after.assigneeId).not.toBeNull();
  const kinds: string[] = after.events.map((e: { kind: string }) => e.kind);
  expect(kinds).toContain("auto_date");
});
