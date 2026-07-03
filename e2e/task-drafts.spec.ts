import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const TITLE_PLACEHOLDER = "ЛБМ 200 + нож, 0,7 мм";

// Доработка №1: непустая форма создания при СЛУЧАЙНОМ закрытии (Escape/клик мимо/крестик) сворачивается
// в черновик — чип внизу; по клику форма открывается заново с восстановленными данными.
test("черновик заявки: свернуть по Escape → чип → восстановить", async ({ page }) => {
  await login(page, "milena");
  await page.goto("/board");
  await expect(page.getByTestId("board")).toBeVisible();

  const title = `Черновик ${Date.now()}`;

  await page.getByRole("button", { name: "Задача" }).click();
  await page.getByPlaceholder(TITLE_PLACEHOLDER).fill(title);

  // Случайное закрытие: Escape. Форма исчезает, но ввод сохраняется в черновик.
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveCount(0);

  const chip = page.getByTestId("draft-chip").filter({ hasText: title });
  await expect(chip).toBeVisible();

  // Клик по чипу открывает форму с восстановленным названием.
  await chip.getByTestId("draft-open").click();
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveValue(title);
});

// Кнопка «Отмена» — осознанный отказ: с подтверждением ввод выбрасывается, черновик НЕ появляется.
test("черновик заявки: «Отмена» с подтверждением выбрасывает, чипа нет", async ({ page }) => {
  await login(page, "milena");
  await page.goto("/board");
  await expect(page.getByTestId("board")).toBeVisible();

  const title = `Отказ ${Date.now()}`;

  await page.getByRole("button", { name: "Задача" }).click();
  await page.getByPlaceholder(TITLE_PLACEHOLDER).fill(title);

  // confirm() подтверждаем автоматически.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Отмена" }).click();

  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveCount(0);
  await expect(page.getByTestId("draft-chip").filter({ hasText: title })).toHaveCount(0);
});
