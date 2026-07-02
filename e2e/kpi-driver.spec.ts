import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { resetActiveTasks } from "./reset";

// Чистый старт для правила «одна активная задача» (этап B): гасим зависшие IN_PROGRESS перед каждым тестом.
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

// Валидный 1×1 JPEG (фото отчёта) и минимальный PDF (акт).
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
    "AAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createAssignedTask(milena: Page, driverLabel: string, typeLabel: string): Promise<string> {
  const title = `e2e-akt ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e акт");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return id;
}

async function advanceToInProgress(req: APIRequestContext, taskId: string): Promise<void> {
  for (const toStatus of ["IN_PROGRESS"]) {
    const r = await req.post(`/api/tasks/${taskId}/transition`, { data: { toStatus } });
    expect(r.status(), `переход в ${toStatus}`).toBe(200);
  }
}

test("акт прикладывается на ремонтной задаче и НЕ блокирует завершение", async ({ browser }) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // Задача A: ремонтный тип (требует и фото, и ожидает акт). Завершаем БЕЗ акта — должно пройти.
  const a = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");
  await advanceToInProgress(driver.request, a);
  // фото отчёта (обязательно для типа) — а акт намеренно не прикладываем
  const photo = await driver.request.post(`/api/tasks/${a}/attachments`, {
    multipart: { file: { name: "photo.jpg", mimeType: "image/jpeg", buffer: JPEG } },
  });
  expect(photo.status()).toBe(201);
  // Акты до 20:00 (02.07): завершая без акта, водитель обязан указать причину (422 без неё)…
  const doneNoReason = await driver.request.post(`/api/tasks/${a}/transition`, { data: { toStatus: "DONE" } });
  expect(doneNoReason.status()).toBe(422);
  expect((await doneNoReason.json()).error.code).toBe("ACT_REASON_REQUIRED");
  // …но с причиной проходит: отсутствие акта по-прежнему НЕ блокирует завершение.
  const doneNoAkt = await driver.request.post(`/api/tasks/${a}/transition`, {
    data: { toStatus: "DONE", actMissedReason: "Не могу приложить (личная причина)" },
  });
  expect(doneNoAkt.status()).toBe(200);

  // Задача B: прикладываем акт (PDF) — создаётся вложение kind=DOCUMENT, видно в задаче.
  const b = await createAssignedTask(milena, "Алексей Каширский", "Выездной ремонт / диагностика");
  await advanceToInProgress(driver.request, b);
  const akt = await driver.request.post(`/api/tasks/${b}/attachments`, {
    multipart: { file: { name: "akt.pdf", mimeType: "application/pdf", buffer: PDF }, kind: "DOCUMENT" },
  });
  expect(akt.status()).toBe(201);
  const detail = (await (await driver.request.get(`/api/tasks/${b}`)).json()).data;
  expect(detail.attachments.some((x: { kind: string }) => x.kind === "DOCUMENT")).toBe(true);

  await mctx.close();
  await dctx.close();
});

test("водитель видит свой расчёт на телефоне (360×740) и не получает чужой", async ({ browser }) => {
  const dctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // Переход из списка задач на экран «Мой расчёт».
  await driver.goto("/m");
  await driver.getByRole("link", { name: "Мой расчёт →" }).click();
  await driver.waitForURL(/\/m\/payroll$/);
  await expect(driver.getByRole("heading", { name: "Мой расчёт" })).toBeVisible();
  await expect(driver.getByText("К выплате")).toBeVisible();

  // Изоляция: расчёт берётся из сессии — подмена driverId в query не отдаёт чужой.
  const period = new Date().toISOString().slice(0, 7);
  const own = (await (await driver.request.get(`/api/my/kpi?period=${period}`)).json()).data;
  expect(own.driverName).toBe("Алексей Каширский");
  const spoof = await driver.request.get(
    `/api/my/kpi?period=${period}&driverId=22222222-2222-2222-2222-222222222222`,
  );
  expect((await spoof.json()).data.driverName).toBe("Алексей Каширский");

  await dctx.close();
});
