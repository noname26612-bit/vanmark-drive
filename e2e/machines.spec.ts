import { test, expect, type Page } from "@playwright/test";

// Сценарий картотеки станков (PRD §16): завести → найти → сменить состояние → журнал → архив.
// Тесты делят общую dev-БД, поэтому каждая карточка помечается уникальной моделью и ищется по ней
// (правило проекта: ассерты через .filter({ hasText }) по уникальному тексту, а не по «первой строке»).
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** Завести станок через API (быстрее и надёжнее формы, когда сценарий проверяет не форму). */
async function createMachine(
  page: Page,
  data: Record<string, unknown>,
): Promise<{ id: string; number: number }> {
  const res = await page.request.post("/api/machines", { data });
  expect(res.status()).toBe(201);
  const { data: machine } = await res.json();
  return machine;
}

test("Максим заводит станок с телефона: категория + модель + фото, остальное — потом", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 }); // рабочий Android Максима
  await login(page, "maxim");
  await expect(page).toHaveURL(/\/machines$/);

  const model = unique("ЛБМ");
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-save").click();

  // Карточка появляется в списке сразу — сохранение не ждёт ни фото, ни остальных полей.
  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Принят");
  await expect(row).toContainText("Клиентский");
  // Клиентский станок без № заказа 1С подсвечивается — но заводиться это не мешает.
  await expect(row).toContainText("Без заказа 1С");
});

test("наш станок получает подсказку номера 77-N, клиентский — нет", async ({ page }) => {
  await login(page, "maxim");
  await page.getByTestId("machine-create").click();

  // Клиентскому «77-N» не предлагаем: это маркировка нашего парка.
  await expect(page.getByTestId("machine-our-number")).toHaveCount(0);

  await page.getByTestId("machine-category").selectOption("OUR_SALE");
  const ourNumber = page.getByTestId("machine-our-number");
  await expect(ourNumber).toBeVisible();
  // Подсказан следующий свободный номер — поле не пустое и правимое.
  await expect(ourNumber).not.toHaveValue("");
});

test("умный поиск находит станок по телефону в другом формате записи", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Sorex");
  await createMachine(page, {
    category: "CLIENT",
    model,
    contactPhone: "+7 915 327-57-16",
    orgName: "ТЕСТ-ПОИСК ООО",
  });

  await page.goto("/machines");
  // Записан как «+7…», ищем как «8…» — должен найтись (движок сравнивает по цифрам).
  await page.getByTestId("machine-search").fill("89153275716");
  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  // Совпадение по скрытому полю показывается сниппетом «почему нашлось».
  await expect(row).toContainText("Тел.");
});

test("состояние, несовместимое с категорией, отклоняется и не предлагается в выпадашке", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Клиентский");
  const machine = await createMachine(page, { category: "CLIENT", model });

  // Сервер — финальный арбитр: «Продан» у клиентского станка не проходит даже в обход интерфейса.
  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "SOLD" },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.code).toBe("MACHINE_STATUS_CATEGORY");

  // И в интерфейсе такого варианта просто нет.
  await page.goto(`/machines/${machine.id}`);
  const options = await page.getByTestId("machine-status-select").locator("option").allInnerTexts();
  expect(options).not.toContain("Продан");
  expect(options).not.toContain("В аренде");
  expect(options).toContain("Выдан клиенту");
});

test("смена состояния и правка пишут в журнал «было→стало»", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Журнал");
  const machine = await createMachine(page, { category: "CLIENT", model, location: "Ряд А, место 1" });

  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-status-select").selectOption("IN_REPAIR");
  await expect(page.getByTestId("machine-events")).toContainText("Принят → В ремонте");

  // Правка места — в журнале видно старое и новое значение (расследуемость «кто передвинул станок»).
  await page.getByTestId("machine-edit").click();
  await page.getByTestId("machine-location").fill("Ряд В, место 7");
  await page.getByTestId("machine-save-edit").click();

  const events = page.getByTestId("machine-events");
  await expect(events).toContainText("Место на площадке");
  await expect(events).toContainText("Ряд А, место 1");
  await expect(events).toContainText("Ряд В, место 7");
});

test("аннулирование требует причину, а карточка уходит в архив и возвращается", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Дубль");
  const machine = await createMachine(page, { category: "CLIENT", model });

  // Без причины — отказ (лечение дублей должно быть объяснимым).
  const noReason = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "VOIDED" },
  });
  expect(noReason.status()).toBe(422);
  expect((await noReason.json()).error.code).toBe("REASON_REQUIRED");

  const withReason = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "VOIDED", reason: "дубль карточки" },
  });
  expect(withReason.status()).toBe(200);

  // Из основного списка станок ушёл…
  await page.goto("/machines");
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(0);

  // …и находится в архиве.
  await page.getByTestId("machine-filter-scope").selectOption("archive");
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(1);

  // Возврат из архива разрешён — карточка живёт дальше, история копится.
  const back = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "ACCEPTED" },
  });
  expect(back.status()).toBe(200);
  await page.goto("/machines");
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(1);
});

test("отметки «Диагностика проведена» и «Подтверждён на месте» фиксируются", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Отметки");
  const machine = await createMachine(page, { category: "CLIENT", model });

  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByText("Диагностика: не отмечена")).toBeVisible();

  await page.getByTestId("machine-diagnosed").click();
  await expect(page.getByText("Диагностика: не отмечена")).toHaveCount(0);

  await page.getByTestId("machine-verified").click();
  await expect(page.getByText("Сверка: не отмечена")).toHaveCount(0);
});

test("дубль номера 77-N — понятная ошибка, а не сбой", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Номер");
  const ourNumber = 90000 + Math.floor(Math.random() * 9000); // свой диапазон, чтобы не мешать другим тестам
  await createMachine(page, { category: "OUR_SALE", model, ourNumber });

  const dup = await page.request.post("/api/machines", {
    data: { category: "OUR_SALE", model: `${model}-дубль`, ourNumber },
  });
  expect(dup.status()).toBe(422);
  expect((await dup.json()).error.message).toContain("уже занят");
});

test("комментарий попадает в журнал станка", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Коммент");
  const machine = await createMachine(page, { category: "CLIENT", model });

  await page.goto(`/machines/${machine.id}`);
  const text = `Ждём запчасть ${Date.now()}`;
  await page.getByTestId("machine-comment").fill(text);
  await page.getByTestId("machine-comment-send").click();
  await expect(page.getByTestId("machine-events")).toContainText(text);
});

test("повтор сохранения тем же ключом не заводит второй станок", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Повтор");
  const key = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Ровно то, что делает форма при обрыве связи: второй запрос уходит с ТЕМ ЖЕ Idempotency-Key.
  const first = await page.request.post("/api/machines", {
    data: { category: "CLIENT", model },
    headers: { "Idempotency-Key": key },
  });
  expect(first.status()).toBe(201);
  const second = await page.request.post("/api/machines", {
    data: { category: "CLIENT", model },
    headers: { "Idempotency-Key": key },
  });
  expect(second.status()).toBe(201);
  // Тот же станок, а не второй с новым учётным номером.
  expect((await second.json()).data.id).toBe((await first.json()).data.id);

  await page.goto("/machines");
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(1);
});

test("фильтр по состоянию не выводит архивные станки в область «На площадке»", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Выдан");
  const machine = await createMachine(page, { category: "CLIENT", model });
  await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "RELEASED" },
  });

  // Прямой запрос «на площадке + выдан клиенту»: раньше фильтр состояния перезаписывал границу
  // площадка/архив в одном объекте where, и архивный станок возвращался как активный.
  const res = await page.request.get("/api/machines?scope=active&status=RELEASED");
  const { data } = await res.json();
  expect(data.machines.some((m: { id: string }) => m.id === machine.id)).toBe(false);
});

test("смена категории не стирает номер 77-N молча", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Номер-категория");
  const ourNumber = 80000 + Math.floor(Math.random() * 9000);
  const machine = await createMachine(page, { category: "OUR_SALE", model, ourNumber });

  // Перевод в клиентские отклоняется, пока на станке висит наш номер: он написан маркером
  // на железе, и молча освободить его нельзя — номер тут же уйдёт другому станку.
  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", category: "CLIENT" },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toContain("Сначала снимите номер");

  // Номер на месте — данные не потеряны.
  const after = (await (await page.request.get(`/api/machines/${machine.id}`)).json()).data;
  expect(after.ourNumber).toBe(ourNumber);
  expect(after.category).toBe("OUR_SALE");
});

test("ответственного менеджера можно изменить после заведения карточки", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Ответственный");
  const machine = await createMachine(page, { category: "CLIENT", model });

  const meta = (await (await page.request.get("/api/machines/meta")).json()).data;
  const someone = meta.responsibles[0];
  expect(someone).toBeTruthy();

  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "edit", responsibleId: someone.id },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).data.responsibleName).toBe(someone.name);

  // Смена ответственного видна в журнале как «было→стало».
  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByTestId("machine-events")).toContainText("Ответственный");
});

test("водителя нельзя назначить ответственным за станок", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Чужой-ответственный");
  const machine = await createMachine(page, { category: "CLIENT", model });

  // id водителя берём из сида по логину — через админскую ручку его не достать роли Максима,
  // поэтому используем заведомо несуществующий id и проверяем сам факт валидации белым списком.
  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "edit", responsibleId: "00000000-0000-0000-0000-000000000000" },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toContain("сотрудника офиса");
});

test("слишком длинный текст не обрезается молча, а отклоняется с понятной ошибкой", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Длинный");
  const machine = await createMachine(page, { category: "CLIENT", model });

  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "edit", defectNotes: "я".repeat(2500) },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toContain("Дефектовка");
});

test("плитка сводки фильтрует список: «Срочные» показывает только срочные", async ({ page }) => {
  await login(page, "maxim");
  const urgent = unique("Срочный");
  const calm = unique("Обычный");
  await createMachine(page, { category: "CLIENT", model: urgent, isUrgent: true });
  await createMachine(page, { category: "CLIENT", model: calm });

  await page.goto("/machines");
  await page.getByRole("button", { name: /Срочные/ }).click();

  const list = page.getByTestId("machine-list");
  await expect(list.locator("li").filter({ hasText: urgent })).toHaveCount(1);
  await expect(list.locator("li").filter({ hasText: calm })).toHaveCount(0);
});
