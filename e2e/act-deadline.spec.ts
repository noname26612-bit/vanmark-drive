// Акты до 20:00 (решение Артёма 02.07): причина при завершении без акта, жёсткий дедлайн
// (акт после 20:00 нарушение не снимает), детали нарушения у Милены, баннер и модалка водителя.
// Общая dev-БД: ассерты — только по уникальным заголовкам задач (память e2e-shared-dev-db).
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const REASON = "Не могу приложить (личная причина)";

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Актовая задача (тип «Доставка / забор из ремонта»: акт нужен, расценки нет) на Каширского.
// Назначение через карточку проставляет дату = сегодня.
async function createActTask(milena: Page): Promise<{ id: string; title: string }> {
  const title = `e2e act-deadline ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Доставка / забор из ремонта" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e act-deadline");
  // Организация/контакт/телефон обязательны при создании (PR #39, 02.07).
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Алексей Каширский" });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  return { id, title };
}

async function candidateFor(req: APIRequestContext, period: string, title: string) {
  const ov = (await (await req.get(`/api/kpi/overview?period=${period}`)).json()).data;
  return ov.candidates.find(
    (c: { taskTitle: string | null; kind: string }) => c.taskTitle === title && c.kind === "UNSIGNED_DOCS",
  );
}

test("жёсткий дедлайн 20:00: причина обязательна, кандидат с причиной, поздний акт не снимает", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  const { id, title } = await createActTask(milena);

  // Завершаем «вчера в 18:00 МСК» (X-Occurred-At, офлайн-механизм): дедлайн акта — вчера 20:00,
  // он уже в прошлом → жёсткость проверяется на живых часах.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const completedAtIso = `${yesterday}T15:00:00.000Z`; // 18:00 МСК вчера
  const period = yesterday.slice(0, 7);

  const r1 = await driver.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(r1.status()).toBe(200);

  // Без причины завершить актовую задачу без акта нельзя (422 ACT_REASON_REQUIRED).
  const noReason = await driver.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "DONE" },
    headers: { "X-Occurred-At": completedAtIso },
  });
  expect(noReason.status()).toBe(422);
  expect((await noReason.json()).error.code).toBe("ACT_REASON_REQUIRED");

  // С причиной — завершается; причина сохранена на задаче и в журнале.
  const done = await driver.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "DONE", actMissedReason: REASON },
    headers: { "X-Occurred-At": completedAtIso },
  });
  expect(done.status()).toBe(200);
  const detail = (await (await driver.request.get(`/api/tasks/${id}`)).json()).data;
  expect(detail.actMissedReason).toBe(REASON);
  expect(
    detail.events.some(
      (e: { kind: string; comment: string | null }) =>
        e.kind === "act_missing_reason" && (e.comment ?? "").includes(REASON),
    ),
  ).toBe(true);

  // Детектор (дедлайн вчера 20:00 прошёл) → кандидат «Без акта» с причиной водителя в note.
  const det = await milena.request.post("/api/kpi/detect", {
    data: { asOf: new Date().toISOString() },
  });
  expect(det.status()).toBe(200);
  const cand = await candidateFor(milena.request, period, title);
  expect(cand).toBeTruthy();
  expect(cand.note).toContain("Акт не приложен до 20:00");
  expect(cand.note).toContain(REASON);

  // Детали нарушения: дедлайн, акта нет, причина водителя.
  const mark = (await (await milena.request.get(`/api/kpi/marks/${cand.id}`)).json()).data;
  expect(mark.actDeadlineAt).toBe(`${yesterday}T17:00:00.000Z`); // 20:00 МСК вчера
  expect(mark.docAttachedAt).toBeNull();
  expect(mark.actMissedReason).toBe(REASON);

  // ЖЁСТКОСТЬ: акт, приложенный сейчас (после дедлайна), кандидата НЕ снимает.
  const up = await driver.request.post(`/api/tasks/${id}/attachments`, {
    multipart: { file: { name: "akt.jpg", mimeType: "image/jpeg", buffer: JPEG }, kind: "DOCUMENT" },
  });
  expect(up.status()).toBe(201);
  const still = await candidateFor(milena.request, period, title);
  expect(still).toBeTruthy();
  const mark2 = (await (await milena.request.get(`/api/kpi/marks/${cand.id}`)).json()).data;
  expect(mark2.docAttachedAt).not.toBeNull(); // акт есть, но поздно — Милена видит момент приложения

  await mctx.close();
  await dctx.close();
});

test("UI водителя: модалка завершения требует причину, баннер «до 20:00» на списке задач", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  const { id } = await createActTask(milena);

  await driver.goto(`/m/${id}`);
  await driver.getByRole("button", { name: "В работу" }).click();
  await driver.getByRole("button", { name: "Завершить →" }).click();

  // Блок «Подписанный акт» в модалке (текст уникален): без выбора причины «Завершить» неактивна.
  await expect(driver.getByText(/По задаче нужен акт, он не приложен/)).toBeVisible();
  const doneBtn = driver.getByRole("button", { name: "Завершить", exact: true });
  await expect(doneBtn).toBeDisabled();
  await driver.getByRole("button", { name: REASON }).click();
  await expect(doneBtn).toBeEnabled();
  await doneBtn.click();
  await expect(driver.getByText("Завершена", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Умный баннер на «Мои задачи»: есть завершённая сегодня актовая задача без акта.
  await driver.goto("/m");
  await expect(driver.getByText(/приложите до\s+20:00/)).toBeVisible({ timeout: 10_000 });

  await mctx.close();
  await dctx.close();
});
