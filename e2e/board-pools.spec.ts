import { test, expect, type Page, type Locator } from "@playwright/test";

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

// п.2: на «Сегодня» убран пул «Не назначено», добавлен «Ближайшие 3 дня».
// Правило без дубля: сегодня — только нераспределённые (назначенные уже в колонках водителей),
// завтра/послезавтра — все задачи (и назначенные).
test("доска: пулы «Без даты» + «Ближайшие 3 дня», без «Не назначено», без дублей", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  await page.goto("/board");
  await expect(page.getByTestId("board")).toBeVisible();

  // typeId и id водителя берём из формы создания.
  await page.getByRole("button", { name: "Задача" }).click();
  const typeId = await page.locator('[data-testid="create-type"] option').first().getAttribute("value");
  const kashId = await page
    .locator('[data-testid="create-assignee"] option', { hasText: "Алексей Каширский" })
    .getAttribute("value");
  await page.getByRole("button", { name: "Отмена" }).click();
  expect(typeId).toBeTruthy();
  expect(kashId).toBeTruthy();

  const now = new Date();
  const today = isoLocal(now);
  const tomorrow = isoLocal(new Date(now.getTime() + 24 * 3600 * 1000));
  const stamp = Date.now();
  const A = `pool сегодня-свободна ${stamp}`;
  const B = `pool сегодня-Каширский ${stamp}`;
  const C = `pool завтра-свободна ${stamp}`;
  const D = `pool завтра-Каширский ${stamp}`;

  const mk = async (title: string, scheduledDate: string, assigneeId?: string) => {
    const res = await page.request.post("/api/tasks", {
      data: {
        typeId,
        title,
        address: "адрес для пула",
        orgName: "ООО Тест",
        contactName: "Иван Тест",
        contactPhone: "+70000000000",
        scheduledDate,
        ...(assigneeId ? { assigneeId } : {}),
      },
    });
    expect(res.ok()).toBeTruthy();
  };
  await mk(A, today);
  await mk(B, today, kashId!);
  await mk(C, tomorrow);
  await mk(D, tomorrow, kashId!);

  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();

  // Колонки «Не назначено» больше нет.
  await expect(page.getByTestId("col-unassigned")).toHaveCount(0);

  const upcoming = page.getByTestId("col-upcoming");
  const kashCol = page.getByTestId(`col-driver-${kashId}`);
  const card = (col: Locator, title: string) =>
    col.locator('[data-testid="board-card"]').filter({ hasText: title });

  // «Ближайшие 3 дня»: сегодня-свободная + обе завтрашние (в т.ч. назначенная).
  await expect(card(upcoming, A)).toBeVisible();
  await expect(card(upcoming, C)).toBeVisible();
  await expect(card(upcoming, D)).toBeVisible();

  // Сегодня-назначенная — в колонке водителя, НЕ в пуле (без дубля).
  await expect(card(kashCol, B)).toBeVisible();
  await expect(card(upcoming, B)).toHaveCount(0);

  // Колонка водителя — только сегодня: свободной и завтрашних там нет.
  await expect(card(kashCol, A)).toHaveCount(0);
  await expect(card(kashCol, D)).toHaveCount(0);
});
