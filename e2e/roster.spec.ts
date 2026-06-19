import { test, expect, type Page } from "@playwright/test";

// Состав исполнителей: подменный водитель Николай (входит, но без расчёта зарплаты) и
// переименованный внешний перевозчик.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("Николай входит, но экрана/ссылки «Мой расчёт» у него нет", async ({ page }) => {
  await login(page, "nikolay");
  await page.goto("/m");
  await expect(page.getByRole("link", { name: /Мой расчёт/ })).toHaveCount(0);

  // Прямой заход на экран расчёта — редирект на список задач (на сервере, не только скрытием ссылки).
  // Серверный redirect() прерывает исходную навигацию (ERR_ABORTED) — ловим и ждём итоговый URL.
  await page.goto("/m/payroll").catch(() => undefined);
  await page.waitForURL(/\/m(?:\/)?$/, { timeout: 10_000 });
});

test("у штатного водителя (Каширский) расчёт зарплаты доступен", async ({ page }) => {
  await login(page, "kashirskiy");
  await page.goto("/m");
  await expect(page.getByRole("link", { name: /Мой расчёт/ })).toBeVisible();
});

test("внешний перевозчик отображается как «Внешний перевозчик»", async ({ page }) => {
  await login(page, "milena");
  await page.goto("/board");
  // Заголовок колонки — это <span> в шапке; селекты-исполнители в карточках используют <option>,
  // поэтому ищем именно span (исключаем совпадения в выпадающих списках назначения).
  await expect(
    page.getByTestId("board-columns").locator("span", { hasText: "Внешний перевозчик" }).first(),
  ).toBeVisible();
});
