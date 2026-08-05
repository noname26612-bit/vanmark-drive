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
