import { test, expect, type Page } from "@playwright/test";

// Этап B: нарушения. №1 — drill-down в детали нарушения. №2 — лайв-актуализация кандидатов
// (исправил задачу → нарушение уходит из списка без повторного прогона детектора).
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Создаёт задачу через UI, назначает водителю и проставляет дату через API (для детектора).
async function createDatedTask(milena: Page, driverLabel: string, typeLabel: string, date: string): Promise<{ id: string; title: string }> {
  const title = `e2e-viol ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  await milena.locator('[data-testid="create-type"]').selectOption({ label: typeLabel });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес e2e нарушения");
  await milena.locator('[data-testid="create-org"]').fill("ООО Тест");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Тест");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000000");
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const id = milena.url().split("/tasks/")[1];
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: driverLabel });
  await expect(milena.locator('[data-testid="card-assignee"]')).not.toHaveValue("");
  const patch = await milena.request.patch(`/api/tasks/${id}`, { data: { op: "edit", scheduledDate: date } });
  expect(patch.ok()).toBeTruthy();
  return { id, title };
}

test("№1 drill-down: детали нарушения для диспетчера, изоляция от водителя", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");

  const { title } = await createDatedTask(milena, "Алексей Каширский", "Сдача / забор из ТК", yesterday);
  const period = yesterday.slice(0, 7);
  expect((await milena.request.post("/api/kpi/detect", { data: { date: yesterday } })).status()).toBe(200);

  const ov = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  const cand = ov.candidates.find((c: { taskTitle: string | null }) => c.taskTitle === title);
  expect(cand).toBeTruthy();

  // Детали нарушения: разбор «почему засчиталось» + поля задачи + тариф штрафа.
  const detRes = await milena.request.get(`/api/kpi/marks/${cand.id}`);
  expect(detRes.status()).toBe(200);
  const det = (await detRes.json()).data;
  expect(det.kind).toBe("MISSED_STOP");
  expect(det.taskTitle).toBe(title);
  expect(det.taskScheduledDate).toBe(yesterday);
  expect(det.penaltyAmount).toBeGreaterThan(0); // тариф штрафа (вес MISSED_STOP)
  expect(det).toHaveProperty("taskStatus");

  // Изоляция: водителю детали нарушения недоступны (диспетчерская ручка → 403).
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await driver.request.get(`/api/kpi/marks/${cand.id}`)).status()).toBe(403);
  await dctx.close();

  await ctx.close();
});

test("№2 лайв: исправленное нарушение уходит из списка без повторного детектора", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");

  const { id, title } = await createDatedTask(milena, "Алексей Каширский", "Сдача / забор из ТК", yesterday);
  const period = yesterday.slice(0, 7);
  expect((await milena.request.post("/api/kpi/detect", { data: { date: yesterday } })).status()).toBe(200);

  // Кандидат есть.
  const ov1 = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  expect(ov1.candidates.find((c: { taskTitle: string | null }) => c.taskTitle === title)).toBeTruthy();

  // «Исправляем» задачу: уводим в финальный статус (отмена). Тот же механизм скрывает кандидата
  // при доведении до «Выполнено» / приложении акта — детектор перепроверяется на чтение.
  const tr = await milena.request.post(`/api/tasks/${id}/transition`, {
    data: { toStatus: "CANCELLED", reason: "e2e: исправление нарушения" },
  });
  expect(tr.ok()).toBeTruthy();

  // overview БЕЗ повторного детектора уже не показывает кандидата (лайв-актуализация на чтение).
  const ov2 = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  expect(ov2.candidates.find((c: { taskTitle: string | null }) => c.taskTitle === title)).toBeFalsy();

  await ctx.close();
});

// Доработка (решение Артёма 02.07.2026): снятие требования акта у ЗАВЕРШЁННОЙ заявки убирает уже
// ПОДТВЕРЖДЁННОЕ нарушение «без акта» из расчёта (syncUnsignedDocMark). Лайв-механизм №2 покрывает только
// кандидатов — здесь проверяем именно CONFIRMED-ветку.
test("акт: снятие требования у завершённой заявки убирает подтверждённое нарушение из расчёта", async ({
  browser,
}) => {
  test.slow();
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");

  // Актовая (ремонтная) задача, назначена Каширскому, дата вчера — попадёт в детектор.
  const { id, title } = await createDatedTask(
    milena,
    "Алексей Каширский",
    "Выездной ремонт / диагностика",
    yesterday,
  );
  const period = yesterday.slice(0, 7);

  // Завершаем без акта (диспетчер ведёт статусы за исполнителя): ASSIGNED → IN_PROGRESS → DONE.
  // Завершение «вчера в 18:00 МСК» (X-Occurred-At): дедлайн акта 20:00 (жёсткий, 02.07) уже прошёл —
  // иначе детектор ждал бы 20:00 сегодняшнего дня и кандидата бы не завёл.
  expect(
    (await milena.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "IN_PROGRESS" } })).ok(),
  ).toBeTruthy();
  expect(
    (
      await milena.request.post(`/api/tasks/${id}/transition`, {
        data: { toStatus: "DONE" },
        headers: { "X-Occurred-At": `${yesterday}T15:00:00.000Z` }, // 18:00 МСК вчера
      })
    ).ok(),
  ).toBeTruthy();

  // Детектор заводит нарушение «без акта»; подтверждаем его (CONFIRMED — попадает в расчёт).
  expect((await milena.request.post("/api/kpi/detect", { data: { asOf: new Date().toISOString() } })).status()).toBe(200);
  const ov = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
  const cand = ov.candidates.find(
    (c: { taskTitle: string | null; kind: string }) =>
      c.taskTitle === title && c.kind === "UNSIGNED_DOCS",
  );
  expect(cand).toBeTruthy();
  expect(
    (await milena.request.post(`/api/kpi/marks/${cand.id}/resolve`, { data: { status: "CONFIRMED" } })).ok(),
  ).toBeTruthy();

  const hasConfirmedMark = async (): Promise<boolean> => {
    const data = (await (await milena.request.get(`/api/kpi/overview?period=${period}`)).json()).data;
    const drv = data.drivers.find((d: { driverName: string }) => d.driverName === "Алексей Каширский");
    return !!drv?.marks?.some((m: { taskTitle: string | null }) => m.taskTitle === title);
  };
  // Подтверждённое нарушение видно в расчёте водителя.
  expect(await hasConfirmedMark()).toBe(true);

  // Снимаем требование акта у ЗАВЕРШЁННОЙ заявки → нарушение уходит из расчёта открытого месяца.
  const patch = await milena.request.patch(`/api/tasks/${id}`, {
    data: { op: "edit", requiresAct: false, actWaivedNote: "e2e: акт не нужен" },
  });
  expect(patch.ok()).toBeTruthy();
  expect(await hasConfirmedMark()).toBe(false);

  await ctx.close();
});
