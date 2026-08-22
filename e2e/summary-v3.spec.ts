// Сводка v3 (решение Артёма 22.08.2026): таблица-сравнение водителей, итоги за период с
// нейтральным «было N», раскрытие строки и период в адресе страницы.
// Общая dev-БД: ассерты — на структуру и уникальные заголовки, не на изменчивые числа.
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });

async function login(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("период живёт в адресе: ?g=day открывает день, клик по разрезу правит URL", async ({ page }) => {
  await login(page, "milena");
  await page.goto(`/summary?g=day&d=${today}`);

  // Разрез из адреса выбран (сегмент — кнопки с aria-pressed, а не radio).
  await expect(page.getByRole("button", { name: "День" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Неделя" })).toHaveAttribute("aria-pressed", "false");

  // Смена разреза переписывает адрес — ссылку на период можно отправить, F5 её не потеряет.
  await page.getByRole("button", { name: "Месяц" }).click();
  await expect(page).toHaveURL(/\/summary\?g=month&d=\d{4}-\d{2}-01$/);
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("button", { name: "Месяц" })).toHaveAttribute("aria-pressed", "true");
});

test("мусор в адресе периода — период по умолчанию, а не ошибка", async ({ page }) => {
  await login(page, "milena");
  const res = await page.goto("/summary?g=zzz&d=2026-02-31");
  expect(res?.status()).toBe(200);
  // Неизвестный разрез → неделя; несуществующая дата → сегодня (страница живая, а не 500).
  await expect(page.getByRole("button", { name: "Неделя" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Сводка по водителям" })).toBeVisible();
});

test("итоги за период: плитки с нейтральным «было N» стоят над таблицей", async ({ page }) => {
  await login(page, "milena");
  await page.goto(`/summary?g=week&d=${today}`);

  const totals = page.getByTestId("summary-totals");
  await expect(totals).toBeVisible();
  await expect(totals.getByTestId("totals-done")).toContainText("Выполнено");
  await expect(totals.getByTestId("totals-load")).toContainText("Загрузка");
  await expect(totals.getByTestId("totals-received")).toContainText("Получено");
  // Сравнение с прошлым периодом — нейтральное «было N», без «+/−» и без зелёного/красного.
  await expect(totals.getByTestId("totals-done")).toContainText(/было \d+/, { timeout: 10_000 });
});

test("таблица водителей: строка на водителя, раскрытие цифры даёт график и список", async ({ page }) => {
  await login(page, "milena");
  await page.goto(`/summary?g=week&d=${today}`);

  // Все активные водители — строками таблицы (карточек v2 больше нет).
  const row = page.getByRole("row").filter({ hasText: "Алексей Каширский" }).first();
  await expect(row).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Алексей Писарев" }).first()).toBeVisible();

  // Клик по цифре раскрывает панель под строкой: график по дням + список за этой цифрой.
  await row.getByTestId("summary-done").click();
  await expect(page.getByTestId("summary-day-chart")).toBeVisible();
  await expect(page.getByTestId("summary-detail")).toBeVisible();

  // Повторный клик по той же цифре сворачивает.
  await row.getByTestId("summary-done").click();
  await expect(page.getByTestId("summary-detail")).toHaveCount(0);
});

test("Максим и водитель до Сводки не допущены", async ({ page }) => {
  await login(page, "maxim");
  await page.goto("/summary");
  await expect(page).not.toHaveURL(/\/summary/);

  await login(page, "kashirskiy");
  await page.goto("/summary");
  await expect(page).not.toHaveURL(/\/summary/);
});
