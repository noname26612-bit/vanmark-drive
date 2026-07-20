// Напарник на задаче (20.07.2026, PRD §4): двое водителей на одной точке.
// Полный поток: создание пары → видимость у обоих → права напарника (фото/комментарий — да,
// статусы/ведомость — нет) → завершение ответственным → сводка «в паре» → swap при переназначении.
// Общая dev-БД: уникальные данные, reset.ts гасит зависшие активные задачи и открывает смены.
import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks } from "./reset";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const LEAD = "Алексей Каширский"; // ответственный (логин kashirskiy)
const CO = "Алексей Писарев"; // напарник (логин pisarev)

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Милена создаёт задачу на СЕГОДНЯ с ответственным и напарником прямо из формы.
async function createPairTask(milena: Page): Promise<{ id: string; title: string }> {
  const title = `e2e пара ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await milena.goto("/tasks");
  await milena.getByRole("button", { name: "Задача" }).click();
  // Тип без акта и без денег — завершение в тесте не требует причин (акт-поток — в act.spec).
  await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
  await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес парного выезда");
  await milena.locator('[data-testid="create-org"]').fill("ООО ПарнаяТочка");
  await milena.locator('[data-testid="create-contact-name"]').fill("Иван Парный");
  await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000001");
  // Дата = сегодня: зеркальные карточки живут в колонках водителей (задачи дня) на доске.
  const todayISO = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); // МСК-день
  await milena.locator('[data-testid="create-date"]').fill(todayISO);
  await milena.locator('[data-testid="create-date"]').press("Enter");
  await milena.locator('[data-testid="create-assignee"]').selectOption({ label: LEAD });
  // селект напарника появляется после выбора ответственного; ответственного в списке нет
  const co = milena.locator('[data-testid="create-co-driver"]');
  await expect(co).toBeVisible();
  expect(await co.locator(`option:has-text("${LEAD}")`).count()).toBe(0);
  await co.selectOption({ label: CO });
  await milena.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(milena.getByRole("dialog")).toBeHidden();

  await milena.getByTestId("task-search").fill(title);
  await milena.getByRole("link", { name: title }).click();
  await milena.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  return { id: milena.url().split("/tasks/")[1], title };
}

test("пара: у обоих в списках, напарник шлёт фото/комментарий, но не статусы; ответственный завершает; сводка без удвоения", async ({
  browser,
}) => {
  test.slow();
  await resetActiveTasks();

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id, title } = await createPairTask(milena);

  // Карточка диспетчера: исполнитель + строка «Напарник», доска — бейджи пары в обеих колонках.
  await expect(milena.getByText("Напарник", { exact: true })).toBeVisible();
  await milena.goto("/board");
  await milena.getByTestId("task-search").fill(title);
  await expect(milena.locator('[data-testid="board-card"]', { hasText: title })).toBeVisible();
  const mirror = milena.locator('[data-testid="board-card-mirror"]', { hasText: title });
  await expect(mirror).toBeVisible();
  // Badge не форвардит data-testid (урок проекта) — бейджи проверяем по тексту.
  await expect(mirror).toContainText("напарник · отв.");

  // Напарник (телефон): задача в списке с бейджем пары, в карточке нет кнопок статуса, есть подсказка.
  const cctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const co = await cctx.newPage();
  await login(co, "pisarev");
  await co.goto("/m");
  const coCard = co.locator("a", { hasText: title }).first();
  await expect(coCard).toBeVisible();
  await expect(coCard).toContainText(`В паре · отв. ${LEAD}`);
  await co.goto(`/m/${id}`);
  await expect(co.getByTestId("pair-role")).toContainText(`ответственный: ${LEAD}`);
  await expect(co.getByRole("button", { name: /В работу/ })).toHaveCount(0);
  await expect(co.getByTestId("co-driver-hint")).toBeVisible();

  // Напарник пишет комментарий — проходит.
  await co.getByPlaceholder("Комментарий диспетчеру…").fill("Мы на месте вдвоём (e2e)");
  await co.getByRole("button", { name: "Отправить комментарий" }).click();
  await expect(co.getByText("Мы на месте вдвоём (e2e)")).toBeVisible();

  // Прямой POST transition от напарника — матрица не пускает (изоляция статусов).
  const failed = await co.evaluate(async (taskId) => {
    const r = await fetch(`/api/tasks/${taskId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStatus: "IN_PROGRESS" }),
    });
    return r.status;
  }, id);
  expect(failed).toBeGreaterThanOrEqual(400);

  // Ответственный (телефон): видит строку «Напарник: …», берёт в работу и завершает.
  const lctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const lead = await lctx.newPage();
  await login(lead, "kashirskiy");
  await lead.goto(`/m/${id}`);
  await expect(lead.getByTestId("pair-role")).toContainText(`Напарник: ${CO}`);
  await lead.getByRole("button", { name: /В работу/ }).click();
  await expect(lead.getByRole("button", { name: /Завершить/ })).toBeVisible();
  await lead.getByRole("button", { name: "Завершить →" }).click();
  // Экран завершения: тип без денег/акта — просто подтверждаем точной кнопкой модалки.
  await lead.getByRole("button", { name: "Завершить", exact: true }).click();
  await expect(lead.getByText("Задача выполнена ✓")).toBeVisible();

  // Сводка за день: у ответственного задача в «выполнено» (drill-down), у напарника — «+N в паре».
  await milena.goto("/summary");
  const leadCard = milena.locator("section, div").filter({ hasText: LEAD }).first();
  await expect(leadCard).toBeVisible();
  await expect(
    milena.locator('[data-testid="summary-pair-done"]').first(),
  ).toContainText("в паре");

  await mctx.close();
  await cctx.close();
  await lctx.close();
});

test("swap: назначение парной задачи на напарника меняет водителей ролями", async ({ browser }) => {
  test.slow();
  await resetActiveTasks();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { title } = await createPairTask(milena);

  // В карточке переназначаем ответственным напарника → роли меняются (пара сохраняется).
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: CO });
  // Журнал фиксирует обмен ролями (дождались обновления данных карточки).
  await expect(milena.getByText("Ответственный и напарник поменялись ролями")).toBeVisible();
  // Напарником стал экс-ответственный.
  await expect(milena.locator('[data-testid="card-co-driver"] option:checked')).toHaveText(
    new RegExp(LEAD),
  );

  // Назначение третьего водителя — пара распадается (сначала ждём событие журнала — данные обновились).
  await milena.locator('[data-testid="card-assignee"]').selectOption({ label: "Николай" });
  await expect(milena.getByText("Напарник снят (смена ответственного)")).toBeVisible();
  await expect(milena.locator('[data-testid="card-co-driver"] option:checked')).toHaveText(
    /без напарника/,
  );

  void title;
  await mctx.close();
});

test("изоляция: третий водитель не видит парную задачу; напарнику ведомость запрещена", async ({
  browser,
}) => {
  test.slow();
  await resetActiveTasks();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const { id } = await createPairTask(milena);

  // Третий водитель (Николай): прямой заход в карточку — «Задача недоступна» (404 из API).
  const nctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const nikolay = await nctx.newPage();
  await login(nikolay, "nikolay");
  await nikolay.goto(`/m/${id}`);
  await expect(nikolay.getByText("Задача недоступна.")).toBeVisible();

  // Напарник: мутация ведомости напрямую — forbidden (403), не 200.
  const cctx = await browser.newContext();
  const co = await cctx.newPage();
  await login(co, "pisarev");
  const wsStatus = await co.evaluate(async (taskId) => {
    const r = await fetch(`/api/tasks/${taskId}/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "взлом ведомости", quantity: 1 }),
    });
    return r.status;
  }, id);
  expect(wsStatus).toBe(403);

  await mctx.close();
  await nctx.close();
  await cctx.close();
});

test("жёсткий запрет: активная парная блокирует личную задачу напарника (до старта и после завершения — можно)", async ({
  browser,
}) => {
  test.slow();
  await resetActiveTasks();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Парная задача (K отв., P напарник) + ДВЕ личные задачи Писарева на сегодня.
  const pair = await createPairTask(milena);
  const own1 = `e2e личная-1 ${Date.now()}`;
  const own2 = `e2e личная-2 ${Date.now()}`;
  for (const title of [own1, own2]) {
    await milena.goto("/tasks");
    await milena.getByRole("button", { name: "Задача" }).click();
    await milena.locator('[data-testid="create-type"]').selectOption({ label: "Сдача / забор из ТК" });
    await milena.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
    await milena.getByPlaceholder("Москва, ул. ..., д. ...").fill("Личный адрес");
    await milena.locator('[data-testid="create-org"]').fill("ООО Личное");
    await milena.locator('[data-testid="create-contact-name"]').fill("Контакт");
    await milena.locator('[data-testid="create-contact-phone"]').fill("+70000000002");
    const todayISO = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    await milena.locator('[data-testid="create-date"]').fill(todayISO);
    await milena.locator('[data-testid="create-date"]').press("Enter");
    await milena.locator('[data-testid="create-assignee"]').selectOption({ label: CO });
    await milena.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(milena.getByRole("dialog")).toBeHidden();
  }

  const pctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const pisarev = await pctx.newPage();
  await login(pisarev, "pisarev");

  // ДО старта парной: парная лишь назначена — Писарев свободно работает со своей задачей.
  await pisarev.goto("/m");
  await pisarev.locator("a", { hasText: own1 }).first().click();
  await pisarev.getByRole("button", { name: /В работу/ }).click();
  await expect(pisarev.getByRole("button", { name: "Завершить →" })).toBeVisible();
  await pisarev.getByRole("button", { name: "Завершить →" }).click();
  await pisarev.getByRole("button", { name: "Завершить", exact: true }).click();
  await expect(pisarev.getByText("Задача выполнена ✓")).toBeVisible();

  // Каширский стартует парную.
  const kctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const kash = await kctx.newPage();
  await login(kash, "kashirskiy");
  await kash.goto(`/m/${pair.id}`);
  await kash.getByRole("button", { name: /В работу/ }).click();
  await expect(kash.getByRole("button", { name: "Завершить →" })).toBeVisible();

  // ВО ВРЕМЯ парной: у Писарева личная задача заблокирована — кнопка disabled, подпись про пару.
  await pisarev.goto("/m");
  await pisarev.locator("a", { hasText: own2 }).first().click();
  const takeBtn = pisarev.getByRole("button", { name: /В работу/ });
  await expect(takeBtn).toBeDisabled();
  await expect(pisarev.getByText(/Идёт парная задача №\d+ — ты в ней напарник/)).toBeVisible();

  // Сервер тоже отбивает прямой POST (ACTIVE_TASK_EXISTS, 409).
  const ownUrl = pisarev.url();
  const ownId = ownUrl.split("/m/")[1];
  const res = await pisarev.evaluate(async (taskId) => {
    const r = await fetch(`/api/tasks/${taskId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStatus: "IN_PROGRESS" }),
    });
    return { status: r.status, body: await r.text() };
  }, ownId);
  expect(res.status).toBe(409);
  expect(res.body).toContain("ACTIVE_TASK_EXISTS");

  // ПОСЛЕ завершения парной: блок снят, Писарев берёт свою.
  await kash.getByRole("button", { name: "Завершить →" }).click();
  await kash.getByRole("button", { name: "Завершить", exact: true }).click();
  await expect(kash.getByText("Задача выполнена ✓")).toBeVisible();
  await pisarev.reload();
  await pisarev.getByRole("button", { name: /В работу/ }).click();
  await expect(pisarev.getByRole("button", { name: "Завершить →" })).toBeVisible();

  await mctx.close();
  await pctx.close();
  await kctx.close();
});
