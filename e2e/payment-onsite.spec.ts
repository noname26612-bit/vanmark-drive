import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Деньги на точке (17.07, оживление «Оплаты на месте», заявка №657): Милена включает тумблер
// «Взять деньги на точке» прямо в форме (не в доп.полях), водитель видит чип в списке и янтарный
// блок с суммой в карточке, при завершении подтверждает получение, Милена видит итог «Оплачено».
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
// Сумма в бейджах форматируется через formatMoney (toLocaleString ru-RU) — разделитель тысяч
// NBSP/узкий пробел. Матчим устойчивым регекспом, чтобы не зависеть от версии ICU.
const AMOUNT_RE = /41[\s  ]?000/;

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("деньги на точке: тумблер в форме → чипы и блок у водителя → «получено» → «Оплачено»", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // 1. Милена создаёт заявку ЧЕРЕЗ ТУМБЛЕР (в этом суть фичи — без «Показать все поля» и без API).
  const title = `e2e деньги ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e деньги");
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Сергей Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000001");
  await milena.locator('[data-testid="create-onsite-toggle"]').check();
  await milena.locator('[data-testid="create-onsite-amount"]').fill("41000");
  await milena.locator('[data-testid="create-onsite-note"]').fill("наличными при выгрузке");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();

  // 2. В таблице «Все задачи» — янтарный чип «Взять деньги · сумма» (новая колонка «Оплата»).
  const row = milena.locator("tr").filter({ hasText: title });
  await expect(row.getByText(/Взять деньги/)).toBeVisible();

  // Назначаем Писарева из карточки.
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Писарев" });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  // Янтарная плашка в карточке диспетчера: призыв + сумма + примечание.
  await expect(milena.getByText("Взять деньги на точке")).toBeVisible();
  await expect(milena.getByText(AMOUNT_RE)).toBeVisible();
  await expect(milena.getByText("наличными при выгрузке")).toBeVisible();

  // 3. Водитель (мобильный вьюпорт): чип в списке ещё до открытия карточки.
  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  await driver.goto("/m");
  const card = driver.locator('a[href^="/m/"]').filter({ hasText: title });
  await expect(card.getByText(/Взять деньги/)).toBeVisible({ timeout: 15_000 });

  // Карточка: янтарный блок с крупной суммой и примечанием.
  await card.click();
  await driver.waitForURL(new RegExp(`/m/${id}$`));
  await expect(driver.getByText("Взять деньги на точке")).toBeVisible();
  await expect(driver.getByText(AMOUNT_RE)).toBeVisible();
  await expect(driver.getByText("наличными при выгрузке")).toBeVisible();

  // 4. В работу → Завершить: в листе завершения сумма предзаполнена, отмечаем «Деньги получены».
  await driver.getByRole("button", { name: "В работу →" }).click();
  await driver.getByRole("button", { name: "Завершить →" }).click({ timeout: 15_000 });
  await expect(driver.getByText("Оплата на месте")).toBeVisible();
  await driver.getByRole("button", { name: "Деньги получены" }).click();
  await expect(driver.locator('input[type="number"]')).toHaveValue("41000");
  await driver.getByRole("button", { name: "Завершить", exact: true }).click();

  // Карточка водителя после завершения: призыв погас, виден итог (зелёный блок; в истории —
  // отдельная строка «Деньги получены: сумма», поэтому exact).
  await expect(driver.getByText("Задача выполнена ✓")).toBeVisible({ timeout: 15_000 });
  await expect(driver.getByText("Деньги получены", { exact: true })).toBeVisible();

  // 5. У Милены: бейдж «Оплачено» в карточке и в таблице «Все задачи».
  await milena.reload();
  await expect(milena.getByText("Оплачено", { exact: true })).toBeVisible({ timeout: 15_000 });
  await milena.goto("/tasks");
  await expect(
    milena.locator("tr").filter({ hasText: title }).getByText("Оплачено", { exact: true }),
  ).toBeVisible();

  await mctx.close();
  await dctx.close();
});

test("тумблер не теряет «через офис» при выключении и не дублирует поля суммы", async ({ browser }) => {
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  // Открываем доп.поля и выбираем «Через офис» селектом.
  await milena.getByRole("button", { name: "Показать все поля" }).click();
  const paySelect = milena
    .locator("label", { hasText: "Оплата" })
    .locator("select")
    .first();
  await paySelect.selectOption({ label: "Через офис" });
  // Тумблер выключен; включаем — селект синхронно показывает «на месте», поля суммы в блоке тумблера.
  const toggle = milena.locator('[data-testid="create-onsite-toggle"]');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(paySelect).toHaveValue("ON_SITE");
  await expect(milena.locator('[data-testid="create-onsite-amount"]')).toBeVisible();
  // Поле суммы на экране ровно одно (в доп.полях сумма для ON_SITE не дублируется).
  await expect(milena.locator('input[type="number"]:visible')).toHaveCount(1);
  // Выключаем — вернулось «Через офис», а не «Без оплаты».
  await toggle.uncheck();
  await expect(paySelect).toHaveValue("OFFICE");

  await mctx.close();
});
