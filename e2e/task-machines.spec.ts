import { test, expect, type Page } from "@playwright/test";
import { resetActiveTasks, taskTypeIdByName, userIdByLogin } from "./reset";

// Связь заявок со станками и автоматика при завершении (этап 2 модуля оборудования, 21.08.2026,
// PRD §16.1). Проверяется весь путь: Милена цепляет станок из пикера → Каширский видит его в
// телефоне (номер, модель, комплект, фото, БЕЗ цены) → завершение переводит карточку станка само.
//
// Тесты делят общую dev-БД и общий ростер: каждая карточка помечается уникальной моделью, заявки —
// уникальным названием, ассерты вешаются через .filter({ hasText }) по этому тексту.
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Валидный 1×1 JPEG (тот же, что в photos.spec.ts): сервер сверяет сигнатуру с заявленным mime.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
    "AAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
  "base64",
);

type Machine = { id: string; ourNumber: number | null; model: string; status: string };

async function createMachine(page: Page, data: Record<string, unknown>): Promise<Machine> {
  const res = await page.request.post("/api/machines", { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data;
}

async function machineDetail(page: Page, id: string) {
  const res = await page.request.get(`/api/machines/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()).data;
}

/** Заявка со станками — через API: сценарий формы проверяется отдельным тестом. */
async function createTask(
  page: Page,
  opts: {
    typeName: string;
    title: string;
    machines: { machineId: string; direction: "OUT" | "IN" }[];
    assigneeLogin?: string;
  },
): Promise<string> {
  const typeId = await taskTypeIdByName(opts.typeName);
  const res = await page.request.post("/api/tasks", {
    data: {
      typeId,
      title: opts.title,
      address: "Адрес e2e станки",
      machines: opts.machines,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const task = (await res.json()).data;
  if (opts.assigneeLogin) {
    const assign = await page.request.patch(`/api/tasks/${task.id}`, {
      data: { op: "assign", assigneeId: await userIdByLogin(opts.assigneeLogin) },
    });
    expect(assign.status(), await assign.text()).toBe(200);
  }
  return task.id as string;
}

/** Провести заявку водителем: в работу → завершить. */
async function finishTask(page: Page, taskId: string): Promise<void> {
  const start = await page.request.post(`/api/tasks/${taskId}/transition`, {
    data: { toStatus: "IN_PROGRESS" },
  });
  expect(start.status(), await start.text()).toBe(200);
  const done = await page.request.post(`/api/tasks/${taskId}/transition`, {
    data: { toStatus: "DONE" },
  });
  expect(done.status(), await done.text()).toBe(200);
}

test("продажа с доставкой: станок в телефоне водителя, завершение переводит его в «Продан»", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // Станок на продажу + нож в комплекте: комплект едет вместе с головным всегда, без галочки.
  const model = unique("Продажа");
  const head = await createMachine(milena, { categories: ["OUR_SALE"], model });
  const knife = await createMachine(milena, {
    categories: ["OUR_SALE"],
    kind: "ROLLER_KNIFE",
    model: `${model}-нож`,
  });
  const kit = await milena.request.post(`/api/machines/${head.id}/kit`, {
    data: { partId: knife.id },
  });
  expect(kit.status(), await kit.text()).toBe(201);
  // Фото станка — водитель должен увидеть, что грузит.
  const photo = await milena.request.post(`/api/machines/${head.id}/attachments`, {
    multipart: { file: { name: "m.jpg", mimeType: "image/jpeg", buffer: JPEG } },
  });
  expect(photo.status(), await photo.text()).toBe(201);

  const title = unique("e2e продажа");
  const taskId = await createTask(milena, {
    typeName: "Доставка проданного об.",
    title,
    machines: [{ machineId: head.id, direction: "OUT" }],
    assigneeLogin: "kashirskiy",
  });

  // --- Водитель ---
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  await driver.goto(`/m/${taskId}`);
  const block = driver.getByTestId("driver-machines");
  await expect(block).toBeVisible();
  await expect(block).toContainText(model);
  await expect(block).toContainText("Везём клиенту");
  await expect(block).toContainText(`${model}-нож`); // состав комплекта
  await expect(block.locator("img")).toHaveCount(1);

  // Деньги водителям не показываются: цены станка в ответе API нет вовсе (не «скрыта в вёрстке»).
  const wire = await (await driver.request.get(`/api/tasks/${taskId}`)).text();
  expect(wire).not.toContain('"price"');

  // Фото станка водителю-исполнителю отдаётся (иначе картинка была бы битой).
  const photoId = (await machineDetail(milena, head.id)).attachments[0].id as string;
  expect((await driver.request.get(`/api/machines/photos/${photoId}`)).status()).toBe(200);

  await finishTask(driver, taskId);

  // --- Автоматика ---
  const after = await machineDetail(milena, head.id);
  expect(after.status).toBe("SOLD");
  const knifeAfter = await machineDetail(milena, knife.id);
  expect(knifeAfter.status).toBe("SOLD"); // комплект уехал вместе с головным
  const journal = (after.events as { comment: string | null }[]).map((e) => e.comment ?? "").join("\n");
  expect(journal).toContain(`по заявке №`);

  await dctx.close();
  await mctx.close();
});

test("забор из аренды: предвыбор «Забираем к нам», возврат в «Готов», отметки нужны заново", async ({
  page,
}) => {
  test.slow();
  await login(page, "milena");
  const model = unique("Аренда");
  const machine = await createMachine(page, { categories: ["OUR_RENTAL"], model });
  // Ставим станок в аренду и отмечаем осмотр — чтобы увидеть, что возврат отметки сбрасывает.
  expect(
    (
      await page.request.patch(`/api/machines/${machine.id}`, {
        data: { op: "status", status: "RENTED" },
      })
    ).status(),
  ).toBe(200);

  // Пикер предлагает направление по состоянию станка: он у клиента — значит забираем.
  const picker = await page.request.get("/api/machines/picker?family=BENDER");
  expect(picker.status()).toBe(200);
  const row = ((await picker.json()).data.machines as { id: string; status: string }[]).find(
    (m) => m.id === machine.id,
  );
  expect(row?.status).toBe("RENTED");

  const taskId = await createTask(page, {
    typeName: "Доставка / забор из аренды",
    title: unique("e2e возврат аренды"),
    machines: [{ machineId: machine.id, direction: "IN" }],
    assigneeLogin: "kashirskiy",
  });
  await finishTask(page, taskId);

  const after = await machineDetail(page, machine.id);
  expect(after.status).toBe("READY");
  // Отметки сброшены самим сервером (backFromRent) — янтарный баннер загорится сам.
  expect(after.diagnosedAt).toBeNull();
  expect(after.lastVerifiedAt).toBeNull();
  const comments = (after.events as { kind: string; comment: string | null }[])
    .filter((e) => e.kind === "comment")
    .map((e) => e.comment ?? "")
    .join("\n");
  expect(comments).toContain("Вернулся из аренды");
});

test("откат завершения и повторное DONE не продают станок дважды", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  const model = unique("Идемпотентность");
  const head = await createMachine(page, { categories: ["OUR_SALE"], model });
  const stock = await createMachine(page, {
    family: "SEAMER",
    kind: "UNCOILER",
    model: `${model}-размотчик`,
    quantity: 5,
  });
  // Складская позиция в комплекте: продажа списывает штуки ровно один раз.
  const seamer = await createMachine(page, {
    family: "SEAMER",
    categories: ["OUR_SALE"],
    model: `${model}-фальц`,
  });
  expect(
    (
      await page.request.post(`/api/machines/${seamer.id}/kit`, {
        data: { partId: stock.id, qty: 2 },
      })
    ).status(),
  ).toBe(201);

  const taskId = await createTask(page, {
    typeName: "Доставка проданного об.",
    title: unique("e2e повтор"),
    machines: [
      { machineId: head.id, direction: "OUT" },
      { machineId: seamer.id, direction: "OUT" },
    ],
    assigneeLogin: "kashirskiy",
  });
  await finishTask(page, taskId);
  expect((await machineDetail(page, stock.id)).quantity).toBe(3); // 5 − 2

  // Диспетчер откатывает завершение и завершает снова — второго списания быть не должно.
  const back = await page.request.post(`/api/tasks/${taskId}/transition`, {
    data: { toStatus: "IN_PROGRESS", reason: "e2e откат" },
  });
  expect(back.status(), await back.text()).toBe(200);
  const again = await page.request.post(`/api/tasks/${taskId}/transition`, {
    data: { toStatus: "DONE" },
  });
  expect(again.status()).toBe(200);
  expect((await machineDetail(page, stock.id)).quantity).toBe(3);
});

test("закупка: отмечает, кто привёз и когда, но состояние не трогает", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  const model = unique("Закупка");
  const machine = await createMachine(page, { categories: ["OUR_SALE"], model });
  expect(machine.status).toBe("NEEDS_REPAIR");

  const taskId = await createTask(page, {
    typeName: "Закупка/выкуп станка",
    title: unique("e2e закупка"),
    // Направление у закупки жёсткое: даже присланное «везём» сервер нормализует в «забираем».
    machines: [{ machineId: machine.id, direction: "OUT" }],
    assigneeLogin: "kashirskiy",
  });
  await finishTask(page, taskId);

  const after = await machineDetail(page, machine.id);
  expect(after.status).toBe("NEEDS_REPAIR"); // что делать дальше — решают на площадке
  expect(after.deliveredBy).toBe("Каширский"); // фамилия ответственного водителя
  expect(after.arrivedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

  // Повторное завершение ничего не переписывает: связь уже обработана (appliedAt).
  const detail = (await (await page.request.get(`/api/tasks/${taskId}`)).json()).data;
  expect(detail.machines[0].direction).toBe("IN");
  expect(detail.machines[0].appliedAt).not.toBeNull();
});

test("сдача через ТК: чужой станок не продаётся, в журнал уходит заметка", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  const model = unique("ТК-клиентский");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  const taskId = await createTask(page, {
    typeName: "Сдача / забор из ТК",
    title: unique("e2e тк"),
    machines: [{ machineId: machine.id, direction: "OUT" }],
    assigneeLogin: "kashirskiy",
  });
  await finishTask(page, taskId);

  const after = await machineDetail(page, machine.id);
  expect(after.status).toBe("NEEDS_REPAIR"); // состояние не менялось
  const comments = (after.events as { kind: string; comment: string | null }[])
    .filter((e) => e.kind === "comment")
    .map((e) => e.comment ?? "")
    .join("\n");
  expect(comments).toContain("Отправлен через ТК");
});

test("задачам сотрудникам станки не привязываются — поле молча вырезается", async ({ page }) => {
  await login(page, "milena");
  const machine = await createMachine(page, {
    categories: ["OUR_SALE"],
    model: unique("Цех-станок"),
  });

  const create = await page.request.post("/api/tasks", {
    data: {
      kind: "STAFF",
      title: unique("e2e цех"),
      machines: [{ machineId: machine.id, direction: "OUT" }],
    },
  });
  expect(create.status(), await create.text()).toBe(201);
  const task = (await create.json()).data;
  expect(task.machines ?? []).toHaveLength(0);

  // И через правку тоже: контур нельзя «размыть» прямым PATCH.
  const patch = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { op: "edit", machines: [{ machineId: machine.id, direction: "OUT" }] },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  expect((await patch.json()).data.machines ?? []).toHaveLength(0);
});

test("изоляция фото станка: исполнителю 200, чужому водителю 404, после архива 404", async ({
  browser,
}) => {
  test.slow();
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  const model = unique("Фотоизоляция");
  const machine = await createMachine(milena, { categories: ["OUR_SALE"], model });
  const upload = await milena.request.post(`/api/machines/${machine.id}/attachments`, {
    multipart: { file: { name: "m.jpg", mimeType: "image/jpeg", buffer: JPEG } },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const photoId = (await upload.json()).data.id as string;

  const taskId = await createTask(milena, {
    typeName: "Доставка проданного об.",
    title: unique("e2e фото"),
    machines: [{ machineId: machine.id, direction: "OUT" }],
    assigneeLogin: "kashirskiy",
  });

  const kctx = await browser.newContext();
  const kashirskiy = await kctx.newPage();
  await login(kashirskiy, "kashirskiy");
  expect((await kashirskiy.request.get(`/api/machines/photos/${photoId}`)).status()).toBe(200);

  // Писарев к заявке отношения не имеет — для него фото не существует (404, не 403).
  const pctx = await browser.newContext();
  const pisarev = await pctx.newPage();
  await login(pisarev, "pisarev");
  expect((await pisarev.request.get(`/api/machines/photos/${photoId}`)).status()).toBe(404);

  // Заявку убрали в архив — доступ пропадает и у исполнителя.
  const archive = await milena.request.patch(`/api/tasks/${taskId}`, {
    data: { op: "archive", reason: "e2e" },
  });
  expect(archive.status(), await archive.text()).toBe(200);
  expect((await kashirskiy.request.get(`/api/machines/photos/${photoId}`)).status()).toBe(404);

  await pctx.close();
  await kctx.close();
  await mctx.close();
});

test("форма заявки: пикер находит станок по номеру и заводит новый, не теряя ввод", async ({
  page,
}) => {
  test.slow();
  await login(page, "milena");
  const model = unique("Пикер");
  const machine = await createMachine(page, { categories: ["OUR_SALE"], model });

  await page.goto("/tasks");
  await page.getByRole("button", { name: "Задача" }).click();
  const title = unique("e2e пикер");
  await page.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(title);
  await page.getByPlaceholder("Москва, ул. ..., д. ...").fill("Адрес пикера");

  // Открываем пикер поверх формы, ищем станок по уникальной модели и выбираем.
  await page.getByTestId("task-pick-machine").click();
  await page.getByTestId("picker-search").fill(model);
  await page.getByTestId(`picker-row-${machine.id}`).click();

  // Заводим второй станок прямо отсюда — цепочка модалок «заявка → пикер → форма станка».
  const newModel = unique("Пикер-новый");
  await page.getByTestId("picker-create-machine").click();
  await page.getByTestId("machine-model").fill(newModel);
  await page.getByTestId("machine-save").click();
  await page.getByTestId("picker-done").click();

  // Форма заявки под пикером не потерялась — название на месте, чипы станков видны.
  await expect(page.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм")).toHaveValue(title);
  const chips = page.getByTestId("task-machines");
  await expect(chips).toContainText(model);
  await expect(chips).toContainText(newModel);

  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByTestId("task-search").fill(title);
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  // В карточке заявки станки видны чипами-ссылками в картотеку.
  await expect(page.getByTestId("task-machines")).toContainText(model);
  await expect(page.getByTestId("task-machines")).toContainText(newModel);
});
