import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Чистый старт для правила «одна активная задача» (этап B): гасим зависшие IN_PROGRESS перед каждым тестом.
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Локальная дата +offset дней в формате YYYY-MM-DD — совпадает с todayISO() доски (местная зона).
function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Этап 6, главный критерий приёмки: изменение статуса водителем видно у Милены на доске
// в течение поллинга (10 с) БЕЗ перезагрузки страницы.
test("живое обновление: смена статуса водителем видна у Милены на доске ≤10 с без F5", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  await milena.goto("/board");

  // Создаём задачу на сегодня и назначаем Каширского прямо с доски (дата по умолчанию = сегодня).
  await milena.getByRole("button", { name: "Задача" }).click();
  const dialog = milena.getByRole("dialog");
  const title = `live ${Date.now()}`;
  await dialog.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
  await dialog.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await dialog.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес live");
  await dialog.locator('[data-testid="create-org"]').fill("ООО Тест");
  await dialog.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await dialog.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await dialog.locator('[data-testid="create-assignee"]').selectOption({ label: "Алексей Каширский" });
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();

  // Карточка появилась на доске (плашку «Назначена» больше не показываем — решение Артёма 24.06).
  const card = milena.getByTestId("board-card").filter({ hasText: title });
  await expect(card).toBeVisible();

  // Узнаём id задачи (через API диспетчера) — водитель сменит статус из своего контекста.
  const listRes = await milena.request.get(`/api/tasks?q=${encodeURIComponent(title)}`);
  const taskId: string = (await listRes.json()).data[0].id;

  // Водитель в отдельном контексте берёт задачу в работу (реальная смена статуса исполнителем).
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  const trans = await driver.request.post(`/api/tasks/${taskId}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(trans.status()).toBe(200);

  // На доске Милены (страница НЕ перезагружалась) статус обновляется поллингом до «В работе»
  // (синяя плашка «В работе» — решение Артёма 24.06).
  await expect(card.getByText("В работе")).toBeVisible({ timeout: 15_000 });

  await mctx.close();
  await dctx.close();
});

// Изоляция нового эндпоинта /api/board/attention: только диспетчер/админ.
test("изоляция: /api/board/attention — водитель 403, гость 401, диспетчер 200", async ({
  browser,
}) => {
  const today = localDate(0);

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await driver.request.get(`/api/board/attention?date=${today}`)).status()).toBe(403);

  const gctx = await browser.newContext();
  const guest = await gctx.newPage();
  expect((await guest.request.get(`/api/board/attention?date=${today}`)).status()).toBe(401);

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const okRes = await milena.request.get(`/api/board/attention?date=${today}`);
  expect(okRes.status()).toBe(200);
  const body = await okRes.json();
  expect(body.data).toHaveProperty("overdue");
  expect(body.data).toHaveProperty("tomorrowPasses");

  await dctx.close();
  await gctx.close();
  await mctx.close();
});

// Этап 6: блок «Требуют внимания» — незаказанный пропуск на завтра и просроченная задача.
test("доска: блок «Требуют внимания» показывает пропуск на завтра и просрочку", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  await page.goto("/board");

  // 1) Задача на завтра с пропуском «нужен, не заказан».
  const passTitle = `attn-pass ${Date.now()}`;
  await page.getByRole("button", { name: "Задача" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator('[data-testid="create-type"]').selectOption({ label: "Доставка / забор из аренды" });
  await dialog.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(passTitle);
  await dialog.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес пропуск");
  await dialog.locator('[data-testid="create-org"]').fill("ООО Тест");
  await dialog.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await dialog.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await dialog.locator('[data-testid="create-date"]').fill(localDate(1));
  await dialog.locator('[data-testid="create-date"]').press("Enter");
  await dialog.getByRole("button", { name: "Показать все поля" }).click();
  await dialog.locator('[data-testid="create-pass"]').selectOption({ label: "Нужен пропуск!" });
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog).toBeHidden();

  // 2) Просроченная задача (дата — вчера, статус остаётся открытым).
  const overdueTitle = `attn-overdue ${Date.now()}`;
  await page.getByRole("button", { name: "Задача" }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator('[data-testid="create-type"]').selectOption({ label: "Прочее" });
  await dialog.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(overdueTitle);
  await dialog.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес просрочка");
  await dialog.locator('[data-testid="create-org"]').fill("ООО Тест");
  await dialog.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await dialog.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await dialog.locator('[data-testid="create-date"]').fill(localDate(-1));
  await dialog.locator('[data-testid="create-date"]').press("Enter");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Блок «Требуют внимания» виден; ассерты привязаны к своим задачам (в общей dev-БД могут
  // лежать чужие записи с прошлых прогонов — фильтруем по уникальному заголовку).
  const block = page.getByTestId("attention-block");
  await expect(block).toBeVisible();

  const passItem = block.getByRole("link").filter({ hasText: passTitle });
  await expect(passItem).toBeVisible();
  await expect(passItem.getByText("Пропуск на завтра не заказан")).toBeVisible();

  const overdueItem = block.getByRole("link").filter({ hasText: overdueTitle });
  await expect(overdueItem).toBeVisible();
  await expect(overdueItem.getByText(/Просрочено/)).toBeVisible();

  // Счётчик «Требуют внимания» > 0.
  await expect(page.getByTestId("stat-attention")).toContainText(/[1-9]/);
});
