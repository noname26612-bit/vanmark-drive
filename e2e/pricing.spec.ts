import { test, expect, type Page } from "@playwright/test";
import { PRICING_ENABLED } from "../src/lib/features";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<string> {
  const title = `e2e pricing ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес для e2e");
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return id;
}

// Водитель формирует и отправляет ведомость через API; возвращает id позиций.
async function fillAndSubmit(driver: Page, id: string): Promise<string[]> {
  const cat = await (await driver.request.get("/api/work-catalog")).json();
  const firstWork: string = cat.data[0].id;
  await driver.request.post(`/api/tasks/${id}/work-items`, { data: { catalogItemId: firstWork, quantity: 2 } });
  await driver.request.post(`/api/tasks/${id}/work-items`, { data: { name: "Доп. работа", quantity: 1 } });
  await driver.request.post(`/api/tasks/${id}/worksheet/submit`);
  const detail = await (await driver.request.get(`/api/tasks/${id}`)).json();
  return detail.data.workItems.map((w: { id: string }) => w.id);
}

test("расценка (API): диспетчер ставит цены → PRICED + суммы; водитель расценить не может; очередь", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  const [w1, w2] = await fillAndSubmit(driver, id);

  // задача попала в очередь на расценку
  const queue = await (await milena.request.get("/api/worksheets/pricing")).json();
  expect(queue.data.some((t: { id: string }) => t.id === id)).toBe(true);

  // водитель не может расценивать (только диспетчер) → 403
  const forbidden = await driver.request.post(`/api/tasks/${id}/worksheet/pricing`, {
    data: { items: [{ id: w1, price: 1500 }] },
  });
  expect(forbidden.status()).toBe(403);

  // диспетчер проставляет цены
  const priced = await milena.request.post(`/api/tasks/${id}/worksheet/pricing`, {
    data: {
      items: [
        { id: w1, price: 1500 },
        { id: w2, price: 500 },
      ],
    },
  });
  expect(priced.status()).toBe(200);

  // PRICED, цены на позициях, итог = 1500×2 + 500×1 = 3500
  const detail = await (await milena.request.get(`/api/tasks/${id}`)).json();
  expect(detail.data.worksheetStatus).toBe("PRICED");
  const byId = Object.fromEntries(
    detail.data.workItems.map((w: { id: string; price: number | null; quantity: number }) => [w.id, w]),
  );
  expect(byId[w1].price).toBe(1500);
  expect(byId[w2].price).toBe(500);
  const total = detail.data.workItems.reduce(
    (s: number, w: { price: number | null; quantity: number }) => s + (w.price ?? 0) * w.quantity,
    0,
  );
  expect(total).toBe(3500);

  // расценённая задача ушла из очереди
  const queue2 = await (await milena.request.get("/api/worksheets/pricing")).json();
  expect(queue2.data.some((t: { id: string }) => t.id === id)).toBe(false);

  await mctx.close();
  await dctx.close();
});

test("расценка (UI): диспетчер видит ведомость, проставляет цену и подтверждает", async ({ browser }) => {
  // Расценка скрыта под флагом PRICING_ENABLED (06.07): раздел /pricing уводит на доску. Тест
  // оживёт сам, когда флаг вернут. API-цикл расценки проверяется тестом выше (эндпоинты живы).
  test.skip(!PRICING_ENABLED, "Раздел «Расценка» скрыт под флагом");
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const id = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  await fillAndSubmit(driver, id);

  // диспетчер открывает компактный экран расценки из очереди → сразу блок цен (решение Артёма 24.06)
  await milena.goto(`/pricing/${id}`);
  await expect(milena.getByText(/Расценка ведомости/)).toBeVisible();
  // кнопка «Открыть всю заявку» ведёт в полную карточку
  await expect(milena.getByRole("link", { name: "Открыть всю заявку" })).toHaveAttribute("href", `/tasks/${id}`);
  // проставляет цену в первую строку и подтверждает
  await milena.locator('input[type="number"]').first().fill("1200");
  await milena.locator('[data-testid="save-pricing"]').click();

  // статус стал PRICED
  await expect
    .poll(async () => {
      const r = await milena.request.get(`/api/tasks/${id}`);
      return (await r.json()).data.worksheetStatus as string;
    })
    .toBe("PRICED");

  await mctx.close();
  await dctx.close();
});
