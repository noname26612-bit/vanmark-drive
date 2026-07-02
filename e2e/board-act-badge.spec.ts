import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Чистый старт для правила «одна активная задача» (этап B): гасим зависшие IN_PROGRESS перед каждым тестом.
test.beforeEach(resetActiveTasks);

// Хвост этапа 14: признак комплектности акта на доске «Сегодня». Показывается ТОЛЬКО на завершённой
// актовой задаче — янтарь «Акт не приложен» / зелёный «Акт приложен». Ассерт привязан к уникальному
// заголовку карточки (общая dev-БД).

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
    "AAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
  "base64",
);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createAssignedTask(milena: Page, title: string): Promise<string> {
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Доставка / забор из ремонта" }); // акт нужен, без расценки
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e");
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Каширский" }); // → дата = сегодня
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return id;
}

async function advanceToDone(req: APIRequestContext, taskId: string): Promise<void> {
  for (const toStatus of ["IN_PROGRESS", "DONE"]) {
    const r = await req.post(`/api/tasks/${taskId}/transition`, { data: { toStatus } });
    expect(r.status(), `переход в ${toStatus}`).toBe(200);
  }
}

test("доска: завершённая актовая задача показывает «Акт не приложен», после акта — «Акт приложен»", async ({
  browser,
}) => {
  test.slow();
  const title = `e2e board-act ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  const id = await createAssignedTask(milena, title);
  await advanceToDone(driver.request, id); // завершена без акта

  // на доске карточка этой задачи помечена «Акт не приложен» (бейдж — компонент Badge, ищем по тексту)
  await milena.goto("/board");
  const card = milena.locator('[data-testid="board-card"]').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("Акт не приложен")).toBeVisible();

  // водитель прикладывает акт → на доске становится «Акт приложен»
  const up = await driver.request.post(`/api/tasks/${id}/attachments`, {
    multipart: { file: { name: "akt.jpg", mimeType: "image/jpeg", buffer: JPEG }, kind: "DOCUMENT" },
  });
  expect(up.status()).toBe(201);

  await milena.reload();
  const card2 = milena.locator('[data-testid="board-card"]').filter({ hasText: title });
  await expect(card2.getByText("Акт приложен")).toBeVisible();

  await mctx.close();
  await dctx.close();
});
