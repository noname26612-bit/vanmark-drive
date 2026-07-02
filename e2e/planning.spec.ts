import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// п.3: вкладка «Планирование» — сетка водители × дни (неделя). op:plan задаёт день + водителя.
test("планирование: пул «Без даты» → ячейка водителя/дня и строка «Без водителя»", async ({ page }) => {
  test.slow();
  await login(page, "milena");

  // typeId и id водителя — из формы создания на доске.
  await page.goto("/board");
  await page.getByRole("button", { name: "Задача" }).click();
  const typeId = await page.locator('[data-testid="create-type"] option').first().getAttribute("value");
  const kashId = await page
    .locator('[data-testid="create-assignee"] option', { hasText: "Алексей Каширский" })
    .getAttribute("value");
  await page.getByRole("button", { name: "Отмена" }).click();
  expect(typeId).toBeTruthy();
  expect(kashId).toBeTruthy();

  const today = isoLocal(new Date());
  const tomorrow = addDaysISO(today, 1);
  const title = `план ${Date.now()}`;

  // Создаём задачу без даты.
  const created = await page.request.post("/api/tasks", {
    data: {
      typeId,
      title,
      address: "адрес планирования",
      orgName: "ООО Тест",
      contactName: "Иван Тест",
      contactPhone: "+70000000000",
    },
  });
  expect(created.ok()).toBeTruthy();
  const taskId: string = (await created.json()).data.id;

  // Вкладка «Планирование» доступна; задача в пуле «Без даты».
  await page.goto("/planning");
  await expect(page.getByTestId("planning")).toBeVisible();
  await expect(page.getByRole("link", { name: "Планирование" })).toBeVisible();
  const undated = page.getByTestId("plan-undated");
  await expect(undated.locator('[data-testid="plan-card"]').filter({ hasText: title })).toBeVisible();

  // op:plan (перетаскивание в ячейку Каширский × завтра).
  const planned = await page.request.patch(`/api/tasks/${taskId}`, {
    data: { op: "plan", scheduledDate: tomorrow, assigneeId: kashId },
  });
  expect(planned.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("planning")).toBeVisible();

  const kashCell = page.getByTestId(`cell-${kashId}-${tomorrow}`);
  await expect(kashCell.locator('[data-testid="plan-card"]').filter({ hasText: title })).toBeVisible();
  // Индикатор загрузки появляется в ячейке водителя (Фаза 2, §14.4).
  await expect(kashCell.getByTestId("cell-load")).toBeVisible();
  // Ушла из «Без даты».
  await expect(
    page.getByTestId("plan-undated").locator('[data-testid="plan-card"]').filter({ hasText: title }),
  ).toHaveCount(0);

  // op:plan со снятием водителя → строка «Без водителя» (cell-none-<день>).
  const unassigned = await page.request.patch(`/api/tasks/${taskId}`, {
    data: { op: "plan", scheduledDate: tomorrow, assigneeId: null },
  });
  expect(unassigned.ok()).toBeTruthy();
  await page.reload();
  const noneCell = page.getByTestId(`cell-none-${tomorrow}`);
  await expect(noneCell.locator('[data-testid="plan-card"]').filter({ hasText: title })).toBeVisible();
  await expect(
    kashCell.locator('[data-testid="plan-card"]').filter({ hasText: title }),
  ).toHaveCount(0);

  // Навигация недели присутствует.
  await expect(page.getByTestId("plan-prev")).toBeVisible();
  await expect(page.getByTestId("plan-next")).toBeVisible();
  await expect(page.getByRole("button", { name: "Сегодня" })).toBeVisible();
});
