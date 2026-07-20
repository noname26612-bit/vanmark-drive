// Умный поиск на вкладках диспетчера: доска «Сегодня» (клиентский матчер с подсветкой и
// сниппетом), «Планирование» (клиентская фильтрация), «Все задачи» (серверный q + debounce).
// Общая dev-БД: данные уникальны по таймстампу, ассерты — только на своих задачах.
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Создаёт задачу с уникальным названием и телефоном через форму на «Все задачи» (без даты —
// на доске она встаёт в пул «Без даты», в планировании — в нижний пул).
async function createTask(page: Page, title: string, phonePretty: string): Promise<void> {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Задача" }).click();
  await page.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await page.getByPlaceholder("Москва, ул. ..., д. ...").fill("Поисковый адрес, Алмазная 12");
  await page.locator('[data-testid="create-org"]').fill("ООО ПоискТест");
  await page.locator('[data-testid="create-contact-name"]').fill("Контакт Поисковый");
  await page.locator('[data-testid="create-contact-phone"]').fill(phonePretty);
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  // модалка закрылась — задача создана
  await expect(page.getByRole("dialog")).toBeHidden();
}

test("доска «Сегодня»: поиск по телефону в другом формате, подсветка, сниппет, приглушение и сброс", async ({
  page,
}) => {
  test.slow();
  const uniq = String(Date.now());
  const tail = uniq.slice(-7); // 7 цифр — уникальный хвост телефона
  const title = `E2E поиск ${uniq}`;
  // В базе телефон «красивый» (+7 916 XXX-XX-XX), искать будем слитно и через «8» —
  // матчер обязан свести оба написания к одним цифрам.
  const phonePretty = `+7 916 ${tail.slice(0, 3)}-${tail.slice(3, 5)}-${tail.slice(5, 7)}`;
  const phoneQuery = `8916${tail}`;

  await login(page, "milena");
  await createTask(page, title, phonePretty);

  await page.goto("/board");
  const search = page.getByTestId("task-search");
  await expect(search).toBeVisible();

  // Поиск по телефону в «неправильном» формате: карточка находится, счётчик показывает 1.
  await search.fill(phoneQuery);
  await expect(page.getByTestId("task-search-count")).toHaveText("Найдено: 1");
  const card = page.locator('[data-testid="board-card"]', { hasText: title });
  await expect(card).toBeVisible();

  // Сниппет «почему нашлось»: совпадение в скрытом поле (телефон) показано строчкой с подсветкой.
  const snippet = card.getByTestId("board-card-snippet");
  await expect(snippet).toBeVisible();
  await expect(snippet).toContainText("Тел.");
  await expect(snippet.locator("mark").first()).toBeVisible();

  // Колонки без совпадений приглушены — в них текст «Нет совпадений».
  await expect(page.getByText("Нет совпадений").first()).toBeVisible();

  // Крестик очищает: счётчик пропадает, доска возвращается к обычному виду.
  await page.getByTestId("task-search-clear").click();
  await expect(page.getByTestId("task-search-count")).toBeHidden();
  await expect(page.getByText("Нет совпадений")).toHaveCount(0);

  // Поиск по названию: подсветка <mark> в самой карточке.
  await search.fill(String(uniq));
  await expect(card.locator("mark").first()).toBeVisible();

  // Esc очищает и снимает фокус.
  await search.press("Escape");
  await expect(search).toHaveValue("");
});

test("доска: свёрнутая колонка с совпадением временно разворачивается и сворачивается обратно", async ({
  page,
}) => {
  test.slow();
  const uniq = String(Date.now());
  const title = `E2E разворот ${uniq}`;
  await login(page, "milena");
  await createTask(page, title, "+7 900 000-00-00");

  await page.goto("/board");
  // Ждём реальную доску (не скелетон) — иначе проверка свёрнутости гоняется с загрузкой.
  await expect(page.getByTestId("board-columns")).toBeVisible();
  // Общая dev-БД: прошлый прогон мог оставить колонку свёрнутой в раскладке аккаунта — разворачиваем.
  const collapsedLeftover = page.getByTestId("col-expand-undated");
  if (await collapsedLeftover.isVisible().catch(() => false)) {
    await collapsedLeftover.click();
  }
  // задача без даты → колонка «Без даты»; сворачиваем её
  await expect(page.locator('[data-testid="board-card"]', { hasText: title })).toBeVisible();
  await page.getByTestId("col-collapse-undated").click();
  await expect(page.locator('[data-testid="col-undated"][data-collapsed="true"]')).toBeVisible();

  // Активный поиск с совпадением в свёрнутой колонке — она разворачивается (раскладка не пишется).
  await page.getByTestId("task-search").fill(String(uniq));
  await expect(page.locator('[data-testid="board-card"]', { hasText: title })).toBeVisible();

  // Очистка — колонка снова свёрнута (персональная раскладка не тронута).
  await page.getByTestId("task-search-clear").click();
  await expect(page.locator('[data-testid="col-undated"][data-collapsed="true"]')).toBeVisible();

  // Возвращаем раскладку (общий аккаунт milena на dev-БД — не оставляем следов).
  await page.getByTestId("col-expand-undated").click();
  await expect(page.locator('[data-testid="col-undated"]:not([data-collapsed])')).toBeVisible();
});

test("планирование: поиск фильтрует карточки и скрывает чип загрузки", async ({ page }) => {
  test.slow();
  const uniq = String(Date.now());
  const title = `E2E план-поиск ${uniq}`;
  await login(page, "milena");
  await createTask(page, title, "+7 901 111-22-33");

  await page.goto("/planning");
  const search = page.getByTestId("task-search");
  await expect(search).toBeVisible();

  // Наша задача без даты — видна в пуле «Без даты» при точном запросе, с подсветкой.
  await search.fill(String(uniq));
  const undatedPool = page.getByTestId("plan-undated");
  const card = undatedPool.locator('[data-testid="plan-card"]', { hasText: title });
  await expect(card).toBeVisible();
  await expect(card.locator("mark").first()).toBeVisible();
  await expect(page.getByTestId("task-search-count")).toHaveText("Найдено: 1");

  // При активном поиске чипы загрузки ячеек скрыты (сумма по отфильтрованным карточкам врала бы).
  await expect(page.getByTestId("cell-load")).toHaveCount(0);

  // Мусорный запрос — «Ничего не найдено» и пустые состояния.
  await search.fill(`нет-такого-${uniq}`);
  await expect(page.getByTestId("task-search-count")).toHaveText("Ничего не найдено");
  await expect(undatedPool.getByText("Нет совпадений")).toBeVisible();
});

test("все задачи: серверный поиск находит телефон в другом формате записи (после debounce)", async ({
  page,
}) => {
  test.slow();
  const uniq = String(Date.now());
  const tail = uniq.slice(-7);
  const title = `E2E все-поиск ${uniq}`;
  const phonePretty = `+7 917 ${tail.slice(0, 3)}-${tail.slice(3, 5)}-${tail.slice(5, 7)}`;

  await login(page, "milena");
  await createTask(page, title, phonePretty);

  await page.goto("/tasks");
  const search = page.getByTestId("task-search");

  // Телефон «через 8», слитно — сервер сводит к цифрам и находит именно нашу задачу.
  await search.fill(`8917${tail}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByTestId("all-tasks-found")).toHaveText("Найдено: 1");

  // Поиск по «№ с решёткой»: берём номер из строки и ищем «№NNN».
  const numberText = await page
    .locator("tbody tr", { hasText: title })
    .locator("td")
    .first()
    .innerText();
  const number = numberText.replace(/\D/g, "");
  await search.fill(`№${number}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // Поиск по подстроке названия работает (contains) и подсвечивает совпадение в таблице.
  await search.fill(`все-поиск ${uniq}`);
  const row = page.locator("tbody tr", { hasText: title });
  await expect(row).toBeVisible();
  await expect(row.locator("mark").first()).toBeVisible();
});
