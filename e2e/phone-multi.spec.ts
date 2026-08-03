// Несколько телефонов в заявке (03.08): у водителя каждый номер — отдельная строка со своей
// ссылкой tel:. Раньше вся строка контакта уходила в href целиком и позвонить было нельзя.
// Общая dev-БД: заголовки уникальны по таймстампу, ассерты — только на своей задаче.
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Создаёт задачу с заданным телефоном и назначает её водителю. Возвращает id и заголовок.
async function createTaskWithPhone(
  milena: Page,
  phone: string,
  driverLabel: string,
): Promise<{ id: string; title: string }> {
  const title = `e2e телефоны ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для телефонов");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill(phone);
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return { id, title };
}

test("несколько номеров: у водителя каждый отдельной строкой и своей ссылкой", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Два номера в свободном формате: разный вид записи, разделитель — запятая.
  const { id, title } = await createTaskWithPhone(
    milena,
    "+7 926 111-22-33, 8 916 444-55-66",
    "Алексей Писарев",
  );

  // Форма подсказала Милене, что распознала оба номера.
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-contact-phone"]').fill("+7 926 111-22-33, 8 916 444-55-66");
  await expect(milena.getByTestId("create-phone-count")).toContainText("2");
  await milena.getByRole("button", { name: "Отмена" }).click();

  // Карточка диспетчера: два отдельных номера, каждый со своим tel:.
  await milena.goto(`/tasks/${id}`);
  const dispatcherLinks = milena.getByTestId("phone-links").getByTestId("call-option");
  await expect(dispatcherLinks).toHaveCount(2);
  await expect(dispatcherLinks.nth(0)).toHaveAttribute("href", "tel:+79261112233");
  await expect(dispatcherLinks.nth(1)).toHaveAttribute("href", "tel:+79164445566");

  // Водитель — мобильный вьюпорт (360×740), как в поле.
  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");

  // Список задач: кнопка «Позвонить · 2» раскрывает номера отдельными строками.
  await driver.goto("/m");
  const card = driver.locator("div").filter({ hasText: title }).last();
  const callButton = card.getByTestId("call-button");
  await expect(callButton).toContainText("2");
  await callButton.click();
  const options = card.getByTestId("call-list").getByTestId("call-option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute("href", "tel:+79261112233");
  await expect(options.nth(1)).toHaveAttribute("href", "tel:+79164445566");
  // Тач-цели у водителя ≥48px (ui-guidelines).
  const box = await options.nth(0).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

  // Карточка задачи: оба номера видны сразу, без лишнего тапа.
  await driver.goto(`/m/${id}`);
  const detailOptions = driver.getByTestId("call-list").getByTestId("call-option");
  await expect(detailOptions).toHaveCount(2);
  await expect(detailOptions.nth(0)).toHaveAttribute("href", "tel:+79261112233");
  await expect(detailOptions.nth(1)).toHaveAttribute("href", "tel:+79164445566");
  await expect(detailOptions.nth(0)).toContainText("+7 926 111-22-33");

  await dctx.close();
  await mctx.close();
});

test("один номер: прежнее поведение — прямая ссылка без списка", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id } = await createTaskWithPhone(milena, "8 (926) 777-88-99", "Алексей Писарев");

  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");

  await driver.goto(`/m/${id}`);
  const callButton = driver.getByTestId("call-button");
  await expect(callButton).toHaveAttribute("href", "tel:+79267778899");
  await expect(callButton).toContainText("Позвонить");
  // Списка нет — лишнего шага у водителя не появилось.
  await expect(driver.getByTestId("call-list")).toHaveCount(0);

  await dctx.close();
  await mctx.close();
});
