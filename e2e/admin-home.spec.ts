// «Управление» v2 (22.08.2026): стартовый экран администратора — «Требует внимания», все разделы
// группами и блок «Система». Плюс вход по ссылкам из плашек: /kpi?period=, /machines?flag=.
// Общая dev-БД: числа изменчивы, поэтому ассерты — на структуру и на конкретную заведённую смену.
import { test, expect, type Page } from "@playwright/test";
import { insertStaleShift, resetShifts } from "./reset";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("«Управление»: вкладки, разделы группами и блок «Система»", async ({ page }) => {
  await login(page, "artem");
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Управление", level: 1 })).toBeVisible();

  // Экран перестал быть тупиком: вкладки навигации на месте (ссылки-карточки ниже ведут туда же,
  // поэтому ищем именно в шапке).
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Водители", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Все задачи", exact: true })).toBeVisible();

  // Разделы, которых в старом хабе не было вовсе.
  for (const name of ["Цех", "Планирование", "Команда", "Листогибы", "Фальцепрокатники"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) }).last()).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /^Пользователи и доступ/ })).toBeVisible();

  // «Система»: версия сборки, расписание рассылок, ссылка на здоровье.
  const system = page.getByTestId("admin-system");
  await expect(system).toContainText("Версия сборки");
  await expect(system).toContainText("08:00");
  await expect(system).toContainText("23:30");
  await expect(system.getByRole("link", { name: "/api/health" })).toBeVisible();
});

test("плашка «Незакрытые смены» появляется и ведёт на доску", async ({ page }) => {
  await resetShifts();
  await insertStaleShift("kashirskiy", 2);
  try {
    await login(page, "artem");
    await page.goto("/admin");

    const tile = page.getByTestId("attention-stale-shifts");
    await expect(tile).toBeVisible();
    await tile.click();
    await page.waitForURL(/\/board/);
    await expect(page.getByTestId("stale-shifts-block")).toBeVisible();
  } finally {
    await resetShifts();
  }
});

test("ссылки плашек открывают нужный экран: /kpi?period= и /machines?flag=", async ({ page }) => {
  await login(page, "artem");

  await page.goto("/kpi?period=2026-07");
  await expect(page.getByText("июль 2026").first()).toBeVisible();

  await page.goto("/machines?flag=duePressing");
  await expect(page.getByTestId("machine-flag-duePressing")).toHaveAttribute("aria-pressed", "true");
});

test("мусор в параметрах — экран по умолчанию, а не ошибка", async ({ page }) => {
  await login(page, "artem");

  const kpi = await page.goto("/kpi?period=zzz");
  expect(kpi?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /KPI/ }).first()).toBeVisible();

  const machines = await page.goto("/machines?flag=zzz");
  expect(machines?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Листогибы" }).first()).toBeVisible();
});

test("«Управление» — только админу: диспетчера и менеджера уводит на их экраны", async ({ page }) => {
  await login(page, "milena");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/board/);

  await login(page, "maxim");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/machines/);
});
