import { test, expect, type Page } from "@playwright/test";

// Задачи сотрудникам (решение Артёма 15.08.2026): второй контур работы — цех и снабжение.
// Тесты делят общую dev-БД, поэтому каждая задача помечается уникальным заголовком и ищется по нему.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

// Смена пользователя внутри теста: без сброса кук /login просто редиректит уже вошедшего на его
// домашний экран, и форма не появляется (тест зависал бы на ожидании поля логина).
async function login(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** Кому можно ставить задачи сотрудникам (Александр и Николай — по персональному флагу). */
async function performers(page: Page): Promise<{ id: string; name: string }[]> {
  const res = await page.request.get("/api/staff-performers");
  expect(res.status()).toBe(200);
  return (await res.json()).data;
}

async function createStaffTask(
  page: Page,
  data: Record<string, unknown>,
): Promise<{ id: string; number: number }> {
  const res = await page.request.post("/api/tasks", { data: { kind: "STAFF", ...data } });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

test("Милена ставит задачу сотруднику через вкладку «Сотрудники»", async ({ page }) => {
  await login(page, "milena");
  await page.goto("/staff");

  const title = unique("Собрать ролики");
  await page.getByTestId("staff-create").click();
  await page.getByTestId("staff-title").fill(title);
  await page.getByTestId("staff-assignee").selectOption({ label: "Александр" });
  await page.getByTestId("staff-save").click();

  // Задача встала в колонку исполнителя — там же, где он увидит её в телефоне.
  const columns = page.getByTestId("staff-columns");
  await expect(columns.getByText(title)).toBeVisible();
});

test("задача сотруднику не мешается на экранах доставок", async ({ page }) => {
  await login(page, "milena");
  const [alexandr] = await performers(page);
  const title = unique("Разобрать поддон");
  await createStaffTask(page, { title, assigneeId: alexandr.id });

  // Доска «Сегодня» и планирование — про заявки водителям.
  await page.goto("/board");
  await expect(page.getByText(title)).toHaveCount(0);
  await page.goto("/planning");
  await expect(page.getByText(title)).toHaveCount(0);

  // Во «Все задачи» её находят на своей половине сегмента, а на половине доставок — нет.
  await page.goto("/tasks");
  await page.getByTestId("tasks-kind-STAFF").click();
  await expect(page.getByRole("cell", { name: title })).toBeVisible();
  await page.getByTestId("tasks-kind-DELIVERY").click();
  await expect(page.getByRole("cell", { name: title })).toHaveCount(0);
});

test("исполнителем можно назначить только того, кому открыт доступ", async ({ page }) => {
  await login(page, "artem"); // список водителей отдаёт админская ручка
  const list = await performers(page);
  expect(list.map((p) => p.name).sort()).toEqual(["Александр", "Николай"]);

  // Каширский возит доставки и к задачам сотрудникам доступа не имеет — назначить его нельзя.
  const drivers = (await (await page.request.get("/api/admin/drivers")).json()).data as {
    id: string;
    name: string;
  }[];
  const kashirskiy = drivers.find((d) => d.name.includes("Каширский"));
  expect(kashirskiy).toBeTruthy();
  const res = await page.request.post("/api/tasks", {
    data: { kind: "STAFF", title: unique("Чужому"), assigneeId: kashirskiy!.id },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toContain("доступ");
});

test("Александр видит задачу в телефоне, берёт в работу без смены и завершает", async ({ page }) => {
  await login(page, "milena");
  const list = await performers(page);
  const alexandr = list.find((p) => p.name === "Александр");
  expect(alexandr).toBeTruthy();
  const title = unique("Заказать подшипники");
  const task = await createStaffTask(page, { title, assigneeId: alexandr!.id });

  await login(page, "alexandr");
  await page.setViewportSize({ width: 360, height: 740 }); // рабочий телефон
  await page.goto("/m");
  await expect(page.getByText(title)).toBeVisible();

  // Смену для работы в цехе открывать не нужно — гейт SHIFT_REQUIRED к этому контуру не применяется.
  const start = await page.request.post(`/api/tasks/${task.id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(start.status()).toBe(200);

  // Завершение не спрашивает ни денег, ни акта: у задачи сотруднику их не бывает.
  const done = await page.request.post(`/api/tasks/${task.id}/transition`, {
    data: { toStatus: "DONE" },
  });
  expect(done.status()).toBe(200);
  expect((await done.json()).data.status).toBe("DONE");
});

test("изоляция: Николай не видит задачу Александра", async ({ page }) => {
  await login(page, "milena");
  const list = await performers(page);
  const alexandr = list.find((p) => p.name === "Александр")!;
  const title = unique("Только Александру");
  const task = await createStaffTask(page, { title, assigneeId: alexandr.id });

  await login(page, "nikolay");
  await page.goto("/m");
  await expect(page.getByText(title)).toHaveCount(0);

  // Прямой заход по id — 404 (чужая задача, как и у доставок).
  const res = await page.request.get(`/api/tasks/${task.id}`);
  expect(res.status()).toBe(404);
});

test("работа в цехе не мешает взять доставку: контуры параллельны", async ({ page }) => {
  await login(page, "artem"); // справочник типов отдаётся админской ручкой
  const list = await performers(page);
  const nikolay = list.find((p) => p.name === "Николай")!;

  // Задача по цеху — в работу.
  const staffTask = await createStaffTask(page, { title: unique("Цех"), assigneeId: nikolay.id });
  const startStaff = await page.request.post(`/api/tasks/${staffTask.id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(startStaff.status()).toBe(200);

  // Доставка тому же исполнителю берётся в работу, несмотря на активную задачу в цехе.
  const types = (await (await page.request.get("/api/admin/task-types")).json()).data as {
    id: string;
    name: string;
    kind?: string;
  }[];
  const typeId = types.find((t) => t.kind !== "STAFF")!.id;
  const delivery = await page.request.post("/api/tasks", {
    data: {
      typeId,
      title: unique("Доставка при цехе"),
      address: "Москва, Ленинградское шоссе, 1",
      assigneeId: nikolay.id,
    },
  });
  expect(delivery.status()).toBe(201);
  const deliveryTask = (await delivery.json()).data;
  const startDelivery = await page.request.post(`/api/tasks/${deliveryTask.id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(startDelivery.status()).toBe(200);

  // А вот вторая доставка — уже нет: правило «одна активная» внутри контура доставок осталось.
  const second = await page.request.post("/api/tasks", {
    data: {
      typeId,
      title: unique("Вторая доставка"),
      address: "Москва, Ленинградское шоссе, 2",
      assigneeId: nikolay.id,
    },
  });
  const secondTask = (await second.json()).data;
  const blocked = await page.request.post(`/api/tasks/${secondTask.id}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(blocked.status()).toBe(409);

  // Прибираем за собой: активные задачи мешают другим тестам на общей БД.
  for (const id of [staffTask.id, deliveryTask.id]) {
    await page.request.post(`/api/tasks/${id}/transition`, { data: { toStatus: "DONE" } });
  }
});

test("задачи сотрудникам не попадают в KPI-нарушения и календарь загрузки", async ({ page }) => {
  await login(page, "milena");
  const list = await performers(page);
  const nikolay = list.find((p) => p.name === "Николай")!;
  const title = unique("Вне календаря");
  await createStaffTask(page, { title, assigneeId: nikolay.id });

  // Календарь загрузки считает маршруты: у задачи цеха нет ни адреса, ни оценки времени.
  const res = await page.request.get(
    `/api/capacity?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`,
  );
  if (res.status() === 200) {
    expect(JSON.stringify(await res.json())).not.toContain(title);
  }
});
