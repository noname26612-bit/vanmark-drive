import { test, expect, type Page } from "@playwright/test";

// Архив заявки (решение Артёма 11.08.2026) и отменённые вне рабочих экранов — одна связка:
// оба механизма убирают заявку из работы, и проверять их надо там, где Милена реально смотрит —
// на «Планировании» (загрузка дня), в списках и в карточке.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

// Смена пользователя внутри теста: без сброса кук /login просто редиректит на домашний экран
// уже вошедшего, и форма не появляется (тест зависал бы на ожидании поля логина).
async function login(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Заводит заявку через API от лица уже залогиненного диспетчера. Возвращает id и номер. */
async function createTask(
  page: Page,
  title: string,
  date: string,
  assigneeId?: string,
): Promise<{ id: string; number: number }> {
  const list = await (await page.request.get("/api/tasks")).json();
  const typeId = (list.data as { type: { id: string } }[])[0].type.id;
  const res = await page.request.post("/api/tasks", {
    data: {
      typeId,
      title,
      address: "Москва, Ленина 1",
      orgName: "ООО Тест",
      contactName: "Иван",
      contactPhone: "+7 900 000-00-00",
      scheduledDate: date,
      ...(assigneeId ? { assigneeId } : {}),
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data as { id: string; number: number };
}

test("архив: заявка исчезает с рабочих экранов и возвращается обратно", async ({ page }) => {
  test.slow();
  await login(page, "milena");

  const today = isoLocal(new Date());
  const title = `Архив-тест ${Date.now()}`;
  const task = await createTask(page, title, today);

  // До архивации заявка видна на доске.
  await page.goto("/board");
  await expect(page.getByText(title)).toBeVisible();

  // Убираем в архив из карточки — тем же путём, что Милена (кнопка + переспрос).
  await page.goto(`/tasks/${task.id}`);
  await page.getByTestId("task-archive").click();
  await page.getByTestId("task-archive-reason").fill("дубль заявки");
  await page.getByTestId("task-archive-confirm").click();
  await expect(page.getByTestId("task-archived-note")).toBeVisible();

  // Исчезла везде, где идёт работа: доска, планирование, календарь, «Все задачи» (активные).
  for (const path of ["/board", "/planning", "/tasks"]) {
    await page.goto(path);
    await expect(page.getByText(title), `${path} не должен показывать архивную заявку`).toHaveCount(0);
  }
  // И из API-выборок тоже (а не только визуально).
  const active = await (await page.request.get(`/api/tasks?q=${encodeURIComponent(title)}`)).json();
  expect(active.data).toHaveLength(0);

  // Находится в разделе «Архив» и возвращается оттуда одной кнопкой.
  const archived = await (
    await page.request.get(`/api/tasks?scope=archive&q=${encodeURIComponent(title)}`)
  ).json();
  expect(archived.data).toHaveLength(1);

  await page.goto("/tasks");
  await page.getByTestId("tasks-scope-archive").click();
  await expect(page.getByText(title)).toBeVisible();
  // Возврат кликаем СТРОГО в своей строке: в архиве лежат и заявки прошлых прогонов, и .first()
  // вернул бы чужую (на общей dev-БД — обычная ловушка, см. CLAUDE.md про e2e).
  await page.locator("tr", { hasText: title }).getByTestId("task-restore").click();
  await expect(page.getByText(title)).toHaveCount(0); // ушла из архива

  await page.goto("/board");
  await expect(page.getByText(title)).toBeVisible(); // вернулась в работу
});

test("архив: журнал хранит обе записи, номер остаётся за заявкой", async ({ page }) => {
  await login(page, "milena");
  const today = isoLocal(new Date());
  const title = `Архив-журнал ${Date.now()}`;
  const task = await createTask(page, title, today);

  await page.request.patch(`/api/tasks/${task.id}`, { data: { op: "archive", reason: "дубль" } });
  await page.request.patch(`/api/tasks/${task.id}`, { data: { op: "unarchive" } });

  const detail = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  const kinds = (detail.data.events as { kind: string; comment: string | null }[]).map((e) => e.kind);
  expect(kinds).toContain("archive");
  expect(kinds).toContain("unarchive");
  expect(detail.data.number).toBe(task.number); // номер не переиспользуется и не меняется
});

test("изоляция архива: водитель не архивирует и не ведёт архивную заявку", async ({ page }) => {
  test.slow();
  await login(page, "milena");

  // Заявка на конкретного водителя — чтобы он мог её видеть по прямой ссылке.
  await page.goto("/board");
  await page.getByRole("button", { name: "Задача" }).click();
  const driverId = await page
    .locator('[data-testid="create-assignee"] option', { hasText: "Алексей Каширский" })
    .getAttribute("value");
  await page.getByRole("button", { name: "Отмена" }).click();

  const today = isoLocal(new Date());
  const task = await createTask(page, `Изоляция-архив ${Date.now()}`, today, driverId!);

  // Водитель архивировать не может — архив принадлежит тем, кто ведёт заявки.
  await login(page, "kashirskiy");
  const forbidden = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { op: "archive", reason: "попытка водителя" },
  });
  expect([403, 404]).toContain(forbidden.status());

  // Милена убирает заявку в архив.
  await login(page, "milena");
  expect(
    (await page.request.patch(`/api/tasks/${task.id}`, { data: { op: "archive" } })).status(),
  ).toBe(200);

  // У водителя она пропала из списка и её нельзя двигать по статусам (в т.ч. отложенной офлайн-очередью).
  await login(page, "kashirskiy");
  const mine = await (await page.request.get(`/api/my/tasks?date=${today}&scope=today`)).json();
  expect((mine.data as { id: string }[]).some((t) => t.id === task.id)).toBe(false);
  const move = await page.request.post(`/api/tasks/${task.id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(move.status(), "архивную заявку вести нельзя").toBeGreaterThanOrEqual(400);

  // И фото к ней не приложить.
  const photo = await page.request.post(`/api/tasks/${task.id}/attachments`, {
    multipart: {
      file: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
    },
  });
  expect(photo.status()).toBeGreaterThanOrEqual(400);

  // Чужой водитель архивную заявку по прямой ссылке по-прежнему не видит — изоляция не ослабла.
  await login(page, "pisarev");
  expect((await page.request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
});

test("отменённая заявка не занимает ячейку «Планирования» и не входит в оценку дня", async ({ page }) => {
  test.slow();
  await login(page, "milena");

  // Водитель нужен, чтобы попасть в строку сетки с чипом загрузки.
  await page.goto("/board");
  await page.getByRole("button", { name: "Задача" }).click();
  const driverId = await page
    .locator('[data-testid="create-assignee"] option', { hasText: "Алексей Каширский" })
    .getAttribute("value");
  await page.getByRole("button", { name: "Отмена" }).click();
  expect(driverId).toBeTruthy();

  const today = isoLocal(new Date());
  const title = `Отменённая ${Date.now()}`;
  const task = await createTask(page, title, today, driverId!);

  await page.goto("/planning");
  await expect(page.getByText(title)).toBeVisible();

  // Отменяем — и заявка уходит из сетки вместе со своей оценкой времени.
  const res = await page.request.post(`/api/tasks/${task.id}/transition`, {
    data: { toStatus: "CANCELLED", comment: "не нужна" },
  });
  expect(res.status()).toBe(200);

  await page.goto("/planning");
  await expect(page.getByText(title), "отменённая не должна висеть в сетке").toHaveCount(0);

  // Списки диспетчера её не отдают, но во «Все задачи» с фильтром по статусу — находится.
  const plan = await (
    await page.request.get(`/api/tasks?hideCancelled=1&q=${encodeURIComponent(title)}`)
  ).json();
  expect(plan.data).toHaveLength(0);
  const all = await (
    await page.request.get(`/api/tasks?status=CANCELLED&q=${encodeURIComponent(title)}`)
  ).json();
  expect(all.data).toHaveLength(1);

  await page.request.patch(`/api/tasks/${task.id}`, { data: { op: "archive", reason: "e2e" } });
});
