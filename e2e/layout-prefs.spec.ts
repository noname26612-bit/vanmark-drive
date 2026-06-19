import { test, expect, type Page } from "@playwright/test";

// Персональная раскладка пулов (порядок + сворачивание) на «Сегодня» и «Планировании».
// Тесты идут под АДМИНОМ (artem) — у него доступ к этим экранам, а настройки изолированы по
// пользователю, поэтому правки не мешают Милене в параллельных спеках. Внутри файла — серийно,
// чтобы тесты не гонялись за общую запись artem.board.order.
test.describe.configure({ mode: "serial" });

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const testidToPoolKey = (t: string): string =>
  t === "col-undated" ? "undated" : t === "col-upcoming" ? "upcoming" : t.replace("col-driver-", "driver:");

async function columnKeys(page: Page): Promise<string[]> {
  const ids = await page
    .locator('[data-testid="board-columns"] > [data-testid]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
  return ids.map(testidToPoolKey);
}

async function rowKeys(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="row-handle-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace("row-handle-", "")));
}

async function setPref(page: Page, key: string, value: string[]): Promise<void> {
  const res = await page.request.put("/api/ui-prefs", { data: { key, value } });
  expect(res.ok()).toBeTruthy();
}

test("доска: персональный порядок пулов сохраняется в аккаунте", async ({ page }) => {
  test.slow();
  await login(page, "artem");
  await setPref(page, "board.order", []);
  await setPref(page, "board.collapsed", []);

  await page.goto("/board");
  await expect(page.getByTestId("col-undated")).toBeVisible(); // дождаться загрузки колонок (не скелетон)
  const def = await columnKeys(page);
  expect(def.length).toBeGreaterThanOrEqual(3);

  const reversed = [...def].reverse();
  await setPref(page, "board.order", reversed);
  await page.reload();
  await expect(page.getByTestId("col-undated")).toBeVisible();
  expect(await columnKeys(page)).toEqual(reversed);

  await setPref(page, "board.order", []); // cleanup
});

test("доска: сворачивание пула сохраняется (клик + перезагрузка)", async ({ page }) => {
  test.slow();
  await login(page, "artem");
  await setPref(page, "board.collapsed", []);

  await page.goto("/board");
  await expect(page.getByTestId("col-upcoming")).toBeVisible();

  // Свернуть по кнопке в шапке.
  await page.getByTestId("col-collapse-upcoming").click();
  await expect(page.getByTestId("col-upcoming")).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("col-expand-upcoming")).toBeVisible();

  // Сохранилось после перезагрузки.
  await page.reload();
  await expect(page.getByTestId("col-upcoming")).toHaveAttribute("data-collapsed", "true");

  // Развернуть кликом по свёрнутой полосе — тоже сохраняется.
  await page.getByTestId("col-expand-upcoming").click();
  await expect(page.getByTestId("col-collapse-upcoming")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("col-collapse-upcoming")).toBeVisible();

  await setPref(page, "board.collapsed", []); // cleanup
});

test("планирование: персональный порядок строк-пулов сохраняется", async ({ page }) => {
  test.slow();
  await login(page, "artem");
  await setPref(page, "planning.order", []);

  await page.goto("/planning");
  await expect(page.getByTestId("row-handle-none")).toBeVisible(); // дождаться сетки (не скелетон)
  const def = await rowKeys(page);
  expect(def.length).toBeGreaterThanOrEqual(2);

  const reversed = [...def].reverse();
  await setPref(page, "planning.order", reversed);
  await page.reload();
  await expect(page.getByTestId("row-handle-none")).toBeVisible();
  expect(await rowKeys(page)).toEqual(reversed);

  await setPref(page, "planning.order", []); // cleanup
});

test("настройки интерфейса изолированы по пользователю и требуют входа", async ({ page, request, browser }) => {
  await login(page, "artem");
  await setPref(page, "board.order", ["upcoming", "undated"]);
  const mine = await (await page.request.get("/api/ui-prefs")).json();
  expect(mine.data["board.order"]).toEqual(["upcoming", "undated"]);

  // Другой пользователь видит СВОИ настройки, не чужие (userId — из сессии). Отдельный контекст,
  // чтобы не перелогиниваться на той же странице.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, "kashirskiy");
  const other = await (await p2.request.get("/api/ui-prefs")).json();
  expect(other.data["board.order"]).not.toEqual(["upcoming", "undated"]);
  await ctx.close();

  // Без входа — 401 (request-фикстура без кук страницы).
  const anon = await request.get("/api/ui-prefs");
  expect(anon.status()).toBe(401);

  // Неизвестный ключ настройки — отказ (artem всё ещё залогинен на page).
  const bad = await page.request.put("/api/ui-prefs", { data: { key: "board.evil", value: [] } });
  expect(bad.status()).toBe(422);
  await setPref(page, "board.order", []); // cleanup
});
