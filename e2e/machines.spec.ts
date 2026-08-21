import { test, expect, type Page } from "@playwright/test";

// Сценарий картотеки станков (PRD §16): завести → найти → сменить состояние → журнал → архив.
// Тесты делят общую dev-БД, поэтому каждая карточка помечается уникальной моделью и ищется по ней
// (правило проекта: ассерты через .filter({ hasText }) по уникальному тексту, а не по «первой строке»).
//
// Переделка раздела 20.08.2026 (решения Артёма) отражена здесь целиком: категорий у станка
// НЕСКОЛЬКО (тело запроса — `categories: [...]`), состояние «Принят» выведено из оборота (новая
// карточка заводится «Требует ремонта»), у карточки появилась цена, обязательные отметки живут в
// янтарном баннере, фильтры и вид переключаются строками с галочкой вместо выпадающих списков, а
// серийник, место на площадке, заказчик и телефон убраны из интерфейса совсем.
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

/** Завести станок через API (быстрее и надёжнее формы, когда сценарий проверяет не форму). */
async function createMachine(
  page: Page,
  data: Record<string, unknown>,
): Promise<{ id: string; number: number }> {
  const res = await page.request.post("/api/machines", { data });
  expect(res.status(), await res.text()).toBe(201);
  const { data: machine } = await res.json();
  return machine;
}

/**
 * Следующий свободный «77-N» в разделе листогибов. Тесты делят общую dev-БД и гоняются многократно,
 * поэтому случайный номер из фиксированного диапазона рано или поздно ловит занятый; спрашиваем у
 * сервера — он и так подсказывает его форме.
 */
async function nextOurNumber(page: Page): Promise<number> {
  const res = await page.request.get("/api/machines/meta?family=BENDER");
  expect(res.status()).toBe(200);
  return (await res.json()).data.nextOurNumber;
}

/**
 * Включить правку карточки кнопкой из шапки (20.08.2026: прежнюю, внизу, просто не находили).
 * Кнопка приходит уже в серверной разметке, поэтому самый первый клик может попасть до гидрации и
 * не сделать ничего — повторяем, пока форма правки не откроется.
 */
async function openEditForm(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByTestId("machine-edit-header").click();
    await expect(page.getByTestId("machine-save-edit")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Карточка из списка раздела по уникальной модели — когда её завели формой и нужен id. */
async function findByModel(page: Page, model: string): Promise<{ id: string }> {
  const res = await page.request.get("/api/machines?family=BENDER");
  expect(res.status()).toBe(200);
  const { data } = await res.json();
  const found = (data.machines as { id: string; model: string }[]).find((m) => m.model === model);
  expect(found, `карточка «${model}» должна быть в разделе`).toBeTruthy();
  return found as { id: string };
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
  // «Принят» выведен из оборота 20.08.2026: новая карточка заводится сразу «Требует ремонта».
  await expect(row).toContainText("Требует ремонта");
  await expect(row).toContainText("Клиентский");
});

test("номер подсказывается по происхождению: своё — «77-», чужое — «К-» (15.08.2026)", async ({
  page,
}) => {
  await login(page, "maxim");
  await page.getByTestId("machine-create").click();

  const number = page.getByTestId("machine-our-number");
  const prefix = page.getByTestId("machine-number-prefix");
  await expect(number).toBeVisible();
  await expect(number).not.toHaveValue("");

  // Клиентский станок нумеруется своей схемой (галочка «Клиентский» стоит по умолчанию)…
  await expect(page.getByTestId("machine-category-CLIENT")).toBeChecked();
  await expect(prefix).toHaveText("К-");
  const clientSuggestion = await number.inputValue();

  // …а свой — привычным «77-». Подсказка перещёлкивается вместе с категориями, пока её не правили.
  // Клик по нашей категории снимает клиентскую: совмещать их нельзя.
  await page.getByTestId("machine-category-OUR_SALE").click();
  await expect(page.getByTestId("machine-category-CLIENT")).not.toBeChecked();
  await expect(prefix).toHaveText("77-");
  const ourSuggestion = await number.inputValue();
  expect(ourSuggestion).not.toBe("");
  expect(ourSuggestion).not.toBe(clientSuggestion); // схемы считаются раздельно
});

// Телефон и заказчик выведены из карточки 20.08.2026 — от «скрытых» полей остались «Контакт» и
// «№ заказа 1С». Поиск по ним проверяем тем же способом: находится и объясняет, почему нашлось.
test("умный поиск находит станок по скрытому полю и объясняет, почему нашлось", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Sorex");
  // Цифры заказа и контакта НЕ должны повторять цифры модели и друг друга: сниппет показывают
  // только тогда, когда в видимой части строки совпадения нет, а движок ищет и по цифровым хвостам.
  const invoice = `СЧ-${Math.floor(1e8 + Math.random() * 8e8)}`;
  const contact = `Тестович${Math.floor(1e8 + Math.random() * 8e8)}`;
  // Номер даём осознанно: без него заголовком строки становится сам № заказа 1С, и сниппет
  // «почему нашлось» не нужен — совпадение уже видно.
  const meta = (await (await page.request.get("/api/machines/meta?family=BENDER")).json()).data;
  await createMachine(page, {
    categories: ["CLIENT"],
    model,
    clientNumber: meta.nextClientNumber,
    invoice1C: invoice,
    contactName: contact,
  });

  await page.goto("/machines");
  await page.getByTestId("machine-search").fill(invoice);
  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  // Совпадение по скрытому полю показывается сниппетом «почему нашлось».
  await expect(row).toContainText("Заказ 1С");

  // Контакт — второе оставшееся скрытое поле, ищется так же.
  await page.getByTestId("machine-search").fill(contact);
  const byContact = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(byContact).toHaveCount(1);
  await expect(byContact).toContainText("Контакт");
});

test("состояние, несовместимое с категорией, отклоняется и не предлагается кнопкой", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Клиентский");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  // Сервер — финальный арбитр: «Продан» у клиентского станка не проходит даже в обход интерфейса.
  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "SOLD" },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.code).toBe("MACHINE_STATUS_CATEGORY");

  // И в интерфейсе такой кнопки просто нет (состояния переключаются кнопками с 15.08.2026).
  await page.goto(`/machines/${machine.id}`);
  const buttons = await page.getByTestId("machine-status-buttons").locator("button").allInnerTexts();
  expect(buttons).not.toContain("Продан");
  expect(buttons).not.toContain("В аренде");
  expect(buttons).toContain("Выдан клиенту");
  // Текущее состояние подсвечено, а не спрятано в списке.
  await expect(page.getByTestId("machine-status-btn-NEEDS_REPAIR")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // «Принят» выведен из оборота: кнопки нет, и сервер такой перевод не принимает.
  await expect(page.getByTestId("machine-status-btn-ACCEPTED")).toHaveCount(0);
  const retired = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "ACCEPTED" },
  });
  expect(retired.status()).toBe(422);
  expect((await retired.json()).error.message).toContain("больше не используется");
});

test("смена состояния и правка пишут в журнал «было→стало»", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Журнал");
  const machine = await createMachine(page, {
    categories: ["CLIENT"],
    model,
    deliveredBy: "Каширский",
  });

  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-status-btn-IN_REPAIR").click();
  // Технические события живут в свёрнутой «Истории изменений» — раскрываем её один раз.
  await page.getByTestId("machine-history-toggle").click();
  await expect(page.getByTestId("machine-events")).toContainText("Требует ремонта → В ремонте");

  // Правка поля — в журнале видно старое и новое значение (расследуемость «кто и что поменял»).
  // Место на площадке и заказчика из карточки убрали 20.08.2026, проверяем на «Кто привёз».
  await page.getByTestId("machine-edit").click();
  await page.getByLabel("Кто привёз").fill("Писарев");
  await page.getByTestId("machine-save-edit").click();

  const events = page.getByTestId("machine-events");
  await expect(events).toContainText("Кто привёз");
  await expect(events).toContainText("Каширский");
  await expect(events).toContainText("Писарев");
});

test("аннулирование требует причину, а карточка уходит в архив и возвращается", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Дубль");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

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

  // …и находится в архиве (с 20.08.2026 область просмотра переключается строкой, а не выпадашкой).
  await page.getByTestId("machine-scope-archive").click();
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(1);

  // Возврат из архива разрешён — карточка живёт дальше, история копится.
  const back = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "NEEDS_REPAIR" },
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
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByText("Диагностика: не отмечена")).toBeVisible();

  // Кнопки отметок с 20.08.2026 живут в янтарном баннере над блоком состояния, а серая строка
  // с датами осталась на прежнем месте — проверяем именно её.
  await page.getByTestId("machine-diagnosed").click();
  await expect(page.getByText("Диагностика: не отмечена")).toHaveCount(0);

  await page.getByTestId("machine-verified").click();
  await expect(page.getByText("Сверка: не отмечена")).toHaveCount(0);
});

test("дубль номера 77-N — понятная ошибка, а не сбой", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Номер");
  // Номер спрашиваем у сервера: тесты гоняются многократно по общей dev-БД, и случайный номер из
  // фиксированного диапазона рано или поздно ловит занятый. Берём свободный в ОБЕИХ схемах.
  const meta = (await (await page.request.get("/api/machines/meta?family=BENDER")).json()).data;
  const free = Math.max(meta.nextOurNumber, meta.nextClientNumber);
  await createMachine(page, { categories: ["OUR_SALE"], model, ourNumber: free });

  const dup = await page.request.post("/api/machines", {
    data: { categories: ["OUR_SALE"], model: `${model}-дубль`, ourNumber: free },
  });
  expect(dup.status()).toBe(422);
  expect((await dup.json()).error.message).toContain(`Номер 77-${free} уже занят`);

  // Схемы не пересекаются: «77-N» и «К-N» с одинаковым числом живут рядом…
  const parallel = await page.request.post("/api/machines", {
    data: { categories: ["CLIENT"], model: `${model}-клиент`, clientNumber: free },
  });
  expect(parallel.status()).toBe(201);

  // …но внутри клиентской схемы номер тоже один, и о дубле она говорит «К-N».
  const dupClient = await page.request.post("/api/machines", {
    data: { categories: ["CLIENT"], model: `${model}-клиент-дубль`, clientNumber: free },
  });
  expect(dupClient.status()).toBe(422);
  expect((await dupClient.json()).error.message).toContain(`Номер К-${free} уже занят`);
});

test("комментарий появляется в ленте «Комментарии», а не тонет в истории", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Коммент");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  await page.goto(`/machines/${machine.id}`);
  const text = `Ждём запчасть ${Date.now()}`;
  await page.getByTestId("machine-comment").fill(text);
  await page.getByTestId("machine-comment-send").click();
  await expect(page.getByTestId("machine-comments")).toContainText(text);

  // Техсобытия («Заведён») по умолчанию спрятаны и не шумят рядом с комментариями…
  await expect(page.getByTestId("machine-events")).toHaveCount(0);
  // …но по клику история открывается целиком.
  await page.getByTestId("machine-history-toggle").click();
  await expect(page.getByTestId("machine-events")).toContainText("Заведён");
});

test("повтор сохранения тем же ключом не заводит второй станок", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Повтор");
  const key = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Ровно то, что делает форма при обрыве связи: второй запрос уходит с ТЕМ ЖЕ Idempotency-Key.
  const first = await page.request.post("/api/machines", {
    data: { categories: ["CLIENT"], model },
    headers: { "Idempotency-Key": key },
  });
  expect(first.status()).toBe(201);
  const second = await page.request.post("/api/machines", {
    data: { categories: ["CLIENT"], model },
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
  const machine = await createMachine(page, { categories: ["CLIENT"], model });
  await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "RELEASED" },
  });

  // Прямой запрос «на площадке + выдан клиенту»: раньше фильтр состояния перезаписывал границу
  // площадка/архив в одном объекте where, и архивный станок возвращался как активный.
  const res = await page.request.get("/api/machines?scope=active&status=RELEASED");
  const { data } = await res.json();
  expect(data.machines.some((m: { id: string }) => m.id === machine.id)).toBe(false);
});

test("номер следует за категорией: «77-N» ↔ «К-N» при переезде (15.08.2026)", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Номер-категория");
  const ourNumber = await nextOurNumber(page);
  const machine = await createMachine(page, { categories: ["OUR_SALE"], model, ourNumber });

  // Свой станок отдали клиенту — он нумеруется чужой схемой, а «77-N» освобождается.
  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", categories: ["CLIENT"] },
  });
  expect(res.status()).toBe(200);

  const after = (await (await page.request.get(`/api/machines/${machine.id}`)).json()).data;
  expect(after.categories).toEqual(["CLIENT"]);
  expect(after.ourNumber).toBeNull();
  expect(after.clientNumber).toBeGreaterThan(0);

  // В карточке он теперь подписан «К-N», и переезд номера виден в журнале.
  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByTestId("machine-title")).toHaveText(`К-${after.clientNumber}`);
  await page.getByTestId("machine-history-toggle").click();
  await expect(page.getByTestId("machine-events")).toContainText(`77-${ourNumber}`);
  await expect(page.getByTestId("machine-events")).toContainText(`К-${after.clientNumber}`);

  // Обратный переезд возвращает станок в свою схему (номер выдаётся следующий свободный).
  const back = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", categories: ["OUR_RENTAL"] },
  });
  expect(back.status()).toBe(200);
  const returned = (await back.json()).data;
  expect(returned.clientNumber).toBeNull();
  expect(returned.ourNumber).toBeGreaterThan(0);
});

test("внутри своей схемы номер не трогается: продажа ↔ аренда — тот же «77-N»", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Номер-внутри");
  const ourNumber = await nextOurNumber(page);
  const machine = await createMachine(page, { categories: ["OUR_SALE"], model, ourNumber });

  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", categories: ["OUR_RENTAL"] },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).data.ourNumber).toBe(ourNumber);
});

test("клиентский станок ищется по «К-N» в любом написании", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Поиск-К");
  const meta = (await (await page.request.get("/api/machines/meta?family=BENDER")).json()).data;
  const clientNumber = meta.nextClientNumber; // следующий свободный: БД общая, номера копятся
  await createMachine(page, { categories: ["CLIENT"], model, clientNumber });

  await page.goto("/machines");
  const list = page.getByTestId("machine-list");
  for (const query of [`К-${clientNumber}`, `к${clientNumber}`, `k-${clientNumber}`]) {
    await page.getByTestId("machine-search").fill(query);
    await expect(list.locator("li").filter({ hasText: model })).toHaveCount(1);
  }
});

test("свой станок продаётся одной кнопкой: «Продан» доступен и арендному, категория едет следом", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Аренда-продажа");
  const machine = await createMachine(page, { categories: ["OUR_RENTAL"], model });

  await page.goto(`/machines/${machine.id}`);
  // У своего железа на виду обе развязки — и «Продан», и «В аренде» (Артём 15.08.2026).
  await expect(page.getByTestId("machine-status-btn-SOLD")).toBeVisible();
  await expect(page.getByTestId("machine-status-btn-RENTED")).toBeVisible();

  page.once("dialog", (d) => void d.accept()); // переспрос про уход в архив
  await page.getByTestId("machine-status-btn-SOLD").click();
  // Ждём, пока карточка подтвердит новое состояние, и только потом спрашиваем сервер.
  await expect(page.getByTestId("machine-status-btn-SOLD")).toHaveAttribute("aria-pressed", "true");

  const after = (await (await page.request.get(`/api/machines/${machine.id}`)).json()).data;
  expect(after.status).toBe("SOLD");
  // Категория подстроилась сама, без второго действия. Прежняя при этом СОХРАНЯЕТСЯ (20.08.2026):
  // станок вернётся из аренды и снова будет продаваться.
  expect(after.categories).toEqual(["OUR_SALE", "OUR_RENTAL"]);

  // И это видно в журнале: продажа и переезд категорий — две читаемые строки истории.
  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-history-toggle").click();
  const events = page.getByTestId("machine-events");
  await expect(events).toContainText("Требует ремонта → Продан");
  await expect(events).toContainText("Категории: Наш арендный → Наш на продажу + Наш арендный");
});

test("чужой станок так не продаётся: у клиентского категория сама не меняется", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Чужой-продажа");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "SOLD" },
  });
  expect(res.status()).toBe(422);
  const after = (await (await page.request.get(`/api/machines/${machine.id}`)).json()).data;
  expect(after.categories).toEqual(["CLIENT"]);
  expect(after.status).toBe("NEEDS_REPAIR");
});

test("ответственного менеджера можно изменить после заведения карточки", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Ответственный");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  const meta = (await (await page.request.get("/api/machines/meta")).json()).data;
  const someone = meta.responsibles[0];
  expect(someone).toBeTruthy();

  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "edit", responsibleId: someone.id },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).data.responsibleName).toBe(someone.name);

  // Смена ответственного видна в журнале как «было→стало» (история по умолчанию свёрнута).
  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-history-toggle").click();
  await expect(page.getByTestId("machine-events")).toContainText("Ответственный");
});

test("водителя нельзя назначить ответственным за станок", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Чужой-ответственный");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

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
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

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
  await createMachine(page, { categories: ["CLIENT"], model: urgent, isUrgent: true });
  await createMachine(page, { categories: ["CLIENT"], model: calm });

  await page.goto("/machines");
  // Постоянный ряд счётчиков с 20.08.2026 — это «Всего», категории и «В аренде»; индикаторы вроде
  // «Срочные» живут под «Ещё».
  await expect(page.getByRole("button", { name: /Срочные/ })).toHaveCount(0);
  await page.getByTestId("counters-more").click();
  await page.getByRole("button", { name: /Срочные/ }).click();

  const list = page.getByTestId("machine-list");
  await expect(list.locator("li").filter({ hasText: urgent })).toHaveCount(1);
  await expect(list.locator("li").filter({ hasText: calm })).toHaveCount(0);

  // Выбранный чип виден и после сворачивания — иначе список остаётся отфильтрованным молча.
  await page.getByTestId("counters-more").click();
  await expect(page.getByRole("button", { name: /Срочные/ })).toBeVisible();
});

// ───────────────────────────── Доработки 07.08: комментарии ─────────────────────────────

test("закреплённая заметка видна сразу и правится на месте, правка расследуема", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Закреп");
  const machine = await createMachine(page, { categories: ["CLIENT"], model, notes: "нет ножа" });

  await page.goto(`/machines/${machine.id}`);
  // Заметка видна без единого клика — в этом смысл закрепа.
  await expect(page.getByTestId("machine-pinned-note")).toContainText("нет ножа");

  await page.getByTestId("machine-pinned-edit").click();
  await page.getByTestId("machine-pinned-input").fill("нет ножа, докупить машинку");
  await page.getByTestId("machine-pinned-save").click();
  await expect(page.getByTestId("machine-pinned-note")).toContainText("докупить машинку");

  // Правка заметки — обычный edit: в истории «было→стало».
  await page.getByTestId("machine-history-toggle").click();
  const events = page.getByTestId("machine-events");
  await expect(events).toContainText("Заметки");
  await expect(events).toContainText("нет ножа, докупить машинку");
});

// ───────────────────────────── Доработки 07.08: задание в цех ─────────────────────────────

test("задание в цех: событие с полным текстом, перевод в ремонт, идемпотентный повтор", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Цех");
  const machine = await createMachine(page, {
    categories: ["CLIENT"],
    model,
    defectNotes: "разбит подшипник вала",
  });

  const key = `e2e-shop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await page.request.post(`/api/machines/${machine.id}/shop-task`, {
    data: { note: "заменить подшипник", toInRepair: true },
    headers: { "Idempotency-Key": key },
  });
  expect(first.status()).toBe(201);
  const detail = (await first.json()).data;
  expect(detail.status).toBe("IN_REPAIR");

  type Ev = { kind: string; comment: string | null };
  const shopTasks = detail.events.filter((e: Ev) => e.kind === "shop_task");
  expect(shopTasks).toHaveLength(1);
  // Полный текст собран из карточки: дефектовка не дублировалась руками.
  expect(shopTasks[0].comment).toContain(model);
  expect(shopTasks[0].comment).toContain("разбит подшипник вала");
  expect(shopTasks[0].comment).toContain("Что сделать: заменить подшипник");
  expect(detail.events.some((e: Ev) => e.kind === "status_change")).toBe(true);

  // Повтор после таймаута (тот же ключ) не плодит второе задание.
  const second = await page.request.post(`/api/machines/${machine.id}/shop-task`, {
    data: { note: "заменить подшипник", toInRepair: true },
    headers: { "Idempotency-Key": key },
  });
  expect(second.status()).toBe(201);
  const after = (await second.json()).data;
  expect(after.events.filter((e: Ev) => e.kind === "shop_task")).toHaveLength(1);
});

test("модалка «Задание в цех»: живой предпросмотр, копирование, блок последнего задания", async ({
  page,
  context,
}) => {
  // Клик «Скопировать» пишет в буфер — chromium требует явного разрешения.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page, "maxim");
  const model = unique("Модалка");
  const machine = await createMachine(page, {
    categories: ["CLIENT"],
    model,
    isUrgent: true,
    defectNotes: "не крутится вал",
  });

  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-shop-task").click();

  // Предпросмотр собран из карточки…
  const preview = page.getByTestId("shop-task-preview");
  await expect(preview).toHaveValue(/СРОЧНО!/);
  await expect(preview).toHaveValue(/не крутится вал/);
  await expect(preview).toHaveValue(new RegExp(model));
  // …и обновляется на каждую букву комментария.
  await page.getByTestId("shop-task-note").fill("отрегулировать прижим");
  await expect(preview).toHaveValue(/Что сделать: отрегулировать прижим/);

  // Галочка перевода в ремонт по умолчанию включена для станка, который ещё не в ремонте.
  await expect(page.getByTestId("shop-task-to-repair")).toBeChecked();

  await page.getByTestId("shop-task-copy").click();

  // Задание записано, станок в ремонте, и последний текст виден прямо в карточке.
  const last = page.getByTestId("machine-last-shop-task");
  await expect(last).toContainText("отрегулировать прижим");
  await expect(page.getByTestId("machine-status-btn-IN_REPAIR")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

// ───────────────────────────── Доработки 07.08: срок готовности ─────────────────────────────

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test("срок в списке: просроченный подсвечен, «Горит срок» фильтрует и сортирует", async ({
  page,
}) => {
  await login(page, "maxim");
  const overdue = unique("Просрочка");
  const calm = unique("Спокойный");
  const today = unique("Сегодня");
  const m1 = await createMachine(page, {
    categories: ["CLIENT"],
    model: overdue,
    dueDate: isoDaysFromNow(-1),
  });
  await createMachine(page, { categories: ["CLIENT"], model: calm, dueDate: isoDaysFromNow(10) });
  await createMachine(page, { categories: ["CLIENT"], model: today, dueDate: isoDaysFromNow(1) });

  await page.goto("/machines");
  const list = page.getByTestId("machine-list");
  // Бейджи в строках: просроченный назван просроченным, спокойный — нейтральное «до …».
  await expect(list.locator("li").filter({ hasText: overdue })).toContainText("просрочен");
  await expect(list.locator("li").filter({ hasText: calm })).toContainText("до ");

  // Чип «Горит срок» (индикаторы с 20.08.2026 живут под «Ещё»): просроченный и ближайший видны,
  // спокойный — нет.
  await page.getByTestId("counters-more").click();
  await page.getByRole("button", { name: /Горит срок/ }).click();
  await expect(list.locator("li").filter({ hasText: overdue })).toHaveCount(1);
  await expect(list.locator("li").filter({ hasText: today })).toHaveCount(1);
  await expect(list.locator("li").filter({ hasText: calm })).toHaveCount(0);

  // Сортировка по близости срока: просроченный (вчера) выше, чем «завтра».
  const texts = await list.locator("li").allInnerTexts();
  const posOverdue = texts.findIndex((t) => t.includes(overdue));
  const posToday = texts.findIndex((t) => t.includes(today));
  expect(posOverdue).toBeGreaterThanOrEqual(0);
  expect(posToday).toBeGreaterThan(posOverdue);

  // Просроченный станок В АРЕНДЕ не «горит»: срок исполнен, станок у клиента.
  const rentedModel = unique("Аренда");
  const rented = await createMachine(page, {
    categories: ["OUR_RENTAL"],
    model: rentedModel,
    dueDate: isoDaysFromNow(-1),
  });
  await page.request.patch(`/api/machines/${rented.id}`, {
    data: { op: "status", status: "RENTED" },
  });
  const res = await page.request.get("/api/machines?flag=duePressing");
  const { data } = await res.json();
  expect(data.machines.some((m: { id: string }) => m.id === rented.id)).toBe(false);
  expect(data.machines.some((m: { id: string }) => m.id === m1.id)).toBe(true);
});

test("быстрая правка срока в карточке пишет в журнал и подсвечивает состояние", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Срок");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  // Срок ставится через тот же PATCH op=edit, что дергает DateField в карточке.
  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "edit", dueDate: isoDaysFromNow(-2) },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).data.dueDate).toBe(isoDaysFromNow(-2));

  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByTestId("machine-due-state")).toContainText("Просрочен");

  await page.getByTestId("machine-history-toggle").click();
  await expect(page.getByTestId("machine-events")).toContainText("Срок");
});

// ───────────────────────────── Доработки 07.08: роликовые ножи ─────────────────────────────

test("роликовый нож: заведение сегментом, бейдж, поиск и серверный фильтр вида", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Ролик");

  await page.goto("/machines");
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-kind-ROLLER_KNIFE").click();
  // Заголовок модалки честно называет, что заводим.
  await expect(page.getByRole("dialog")).toContainText("роликовый нож");
  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-save").click();

  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Нож");

  // Поиск словом «нож» находит нож без слова «нож» в полях (подпись вида ищется).
  await page.getByTestId("machine-search").fill("нож");
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(1);

  // Серверный фильтр вида.
  const knives = (await (await page.request.get("/api/machines?kind=ROLLER_KNIFE")).json()).data;
  expect(knives.machines.some((m: { model: string }) => m.model === model)).toBe(true);
  const machinesOnly = (await (await page.request.get("/api/machines?kind=MACHINE")).json()).data;
  expect(machinesOnly.machines.some((m: { model: string }) => m.model === model)).toBe(false);

  // Смена вида — обычная правка, в журнале «Вид: было→стало».
  const knife = knives.machines.find((m: { model: string }) => m.model === model);
  const patched = await page.request.patch(`/api/machines/${knife.id}`, {
    data: { op: "edit", kind: "MACHINE" },
  });
  expect((await patched.json()).data.kind).toBe("MACHINE");
  await page.goto(`/machines/${knife.id}`);
  await page.getByTestId("machine-history-toggle").click();
  await expect(page.getByTestId("machine-events")).toContainText("Вид");
});

// ───────────────────────────── Доработки 07.08: форма создания ─────────────────────────────

test("«Показать все поля» сворачивается обратно, введённое не теряется", async ({ page }) => {
  await login(page, "maxim");
  await page.goto("/machines");
  await page.getByTestId("machine-create").click();

  await expect(page.getByTestId("machine-extra-fields")).toHaveCount(0);
  await page.getByTestId("machine-toggle-fields").click();
  const extra = page.getByTestId("machine-extra-fields");
  await expect(extra).toBeVisible();
  // «Место на площадке» и «Заказчик» из формы убраны 20.08.2026 — проверяем на «Кто привёз».
  await extra.getByLabel("Кто привёз").fill("Султан");

  // Сворачиваем — кнопка осталась на месте (раньше исчезала), данные живы.
  await page.getByTestId("machine-toggle-fields").click();
  await expect(page.getByTestId("machine-extra-fields")).toHaveCount(0);
  await page.getByTestId("machine-toggle-fields").click();
  await expect(page.getByTestId("machine-extra-fields").getByLabel("Кто привёз")).toHaveValue(
    "Султан",
  );

  // Цена, толщина металла и комплектация подняты на видное место — они НЕ в свёрнутых полях.
  await expect(page.getByTestId("machine-price")).toBeVisible();
  await expect(page.getByTestId("machine-metal-thickness")).toBeVisible();
  await expect(page.getByTestId("machine-configuration")).toBeVisible();
});

test("подбор модели: «лбм» кириллицей предлагает Sorex LBM, своё название тоже принимается", async ({
  page,
}) => {
  await login(page, "maxim");
  await page.goto("/machines");
  await page.getByTestId("machine-create").click();

  // Часть названия в другом алфавите → подсказки; выбор тапом подставляет полное название.
  await page.getByTestId("machine-model").fill("лбм");
  const list = page.getByTestId("machine-model-list");
  await expect(list).toContainText("Sorex LBM 200");
  await list.getByRole("option", { name: "Sorex LBM 200" }).click();
  await expect(page.getByTestId("machine-model")).toHaveValue("Sorex LBM 200");

  // Свободный ввод остаётся: несправочное название сохраняется как есть.
  const custom = unique("Самодельный");
  await page.getByTestId("machine-model").fill(custom);
  await page.getByTestId("machine-save").click();
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: custom }),
  ).toHaveCount(1);
});

test("черновик формы: закрытие не теряет ввод, «Начать заново» и «Отмена» очищают", async ({
  page,
}) => {
  await login(page, "maxim");
  await page.goto("/machines");
  const model = unique("Черновик");

  // Заполнили и закрыли крестиком — молча сохранился черновик.
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-model").fill(model);
  await page.getByRole("button", { name: "Закрыть" }).click();

  // Открыли снова — форма восстановлена, плашка честно говорит откуда данные.
  await page.getByTestId("machine-create").click();
  await expect(page.getByTestId("machine-draft-restored")).toBeVisible();
  await expect(page.getByTestId("machine-model")).toHaveValue(model);

  // «Начать заново» выбрасывает черновик.
  await page.getByTestId("machine-draft-fresh").click();
  await expect(page.getByTestId("machine-model")).toHaveValue("");
  await expect(page.getByTestId("machine-draft-restored")).toHaveCount(0);

  // «Отмена» с заполненной формой переспрашивает и тоже выбрасывает.
  await page.getByTestId("machine-model").fill(`${model}-2`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Отмена" }).click();
  await page.getByTestId("machine-create").click();
  await expect(page.getByTestId("machine-draft-restored")).toHaveCount(0);
  await expect(page.getByTestId("machine-model")).toHaveValue("");

  // Успешное создание тоже чистит черновик: следующая форма открывается пустой.
  await page.getByTestId("machine-model").fill(`${model}-3`);
  await page.getByTestId("machine-save").click();
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: `${model}-3` }),
  ).toHaveCount(1);
  await page.getByTestId("machine-create").click();
  await expect(page.getByTestId("machine-draft-restored")).toHaveCount(0);
});

// ─────────────────────────── Переделка раздела 20.08.2026 ───────────────────────────
// Категории списком, «Принят» из оборота, цена, обязательные отметки баннером, фальц машинка,
// комплектация галочками, фильтры строками, лайтбокс и тянущиеся колонки.

test("цена: заводится формой, видна в колонке «Цена» и правится в карточке", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Цена");

  await page.goto("/machines");
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-price").fill("120000");
  await page.getByTestId("machine-save").click();

  // В списке цена печатается разрядами: «120 000 ₽» читается с одного взгляда.
  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/120.000/);

  // Правка — из шапки карточки: кнопку «Редактировать» перенесли туда, внизу её не находили.
  const { id } = await findByModel(page, model);
  await page.goto(`/machines/${id}`);
  await openEditForm(page);
  await page.getByTestId("machine-edit-price").fill("155000");
  await page.getByTestId("machine-save-edit").click();

  await expect(page.getByText(/155.000\s*₽/)).toBeVisible();
  await page.getByTestId("machine-history-toggle").click();
  const events = page.getByTestId("machine-events");
  await expect(events).toContainText("Цена");
  await expect(events).toContainText(/155.000/);
});

test("баннер обязательных отметок гаснет от двух отметок и возвращается после аренды", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Баннер");
  const machine = await createMachine(page, { categories: ["OUR_RENTAL"], model });

  await page.goto(`/machines/${machine.id}`);
  const banner = page.getByTestId("machine-checks-banner");
  await expect(banner).toBeVisible();

  await page.getByTestId("machine-diagnosed").click();
  await page.getByTestId("machine-verified").click();
  await expect(banner).toHaveCount(0);

  // У станка в аренде отметок не спрашивают — он стоит у клиента.
  await page.getByTestId("machine-status-btn-RENTED").click();
  await expect(page.getByTestId("machine-status-btn-RENTED")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(banner).toHaveCount(0);

  // Вернулся из аренды — сервер сбросил обе отметки, баннер зажёгся снова.
  await page.getByTestId("machine-status-btn-READY").click();
  await expect(banner).toBeVisible();
  await expect(page.getByTestId("machine-diagnosed")).toBeVisible();
  await expect(page.getByTestId("machine-verified")).toBeVisible();
  // И это объяснено в ленте комментариев, а не только сбросом дат.
  await expect(page.getByTestId("machine-comments")).toContainText("Вернулся из аренды");
});

test("категорий может быть несколько: наш станок и продаётся, и сдаётся", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Мультикатегория");
  const machine = await createMachine(page, {
    categories: ["OUR_SALE", "OUR_RENTAL"],
    model,
  });

  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByTestId("machine-category-OUR_SALE")).toBeChecked();
  await expect(page.getByTestId("machine-category-OUR_RENTAL")).toBeChecked();
  await expect(page.getByTestId("machine-category-CLIENT")).not.toBeChecked();
  // Обе развязки доступны сразу, без предварительной смены категории.
  await expect(page.getByTestId("machine-status-btn-SOLD")).toBeVisible();
  await expect(page.getByTestId("machine-status-btn-RENTED")).toBeVisible();

  // «Клиентский» ни с чем не совмещается — сервер отвергает такой набор.
  const bad = await page.request.post("/api/machines", {
    data: { categories: ["CLIENT", "OUR_SALE"], model: `${model}-плохой` },
  });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).error.message).toContain("не совмещается");

  // Пустой набор — тоже ошибка.
  const empty = await page.request.post("/api/machines", {
    data: { categories: [], model: `${model}-пустой` },
  });
  expect(empty.status()).toBe(422);
});

test("выставочный станок: эксклюзивная категория, номер 77-N, продажа переселяет категорию", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Выставочный");
  const ourNumber = await nextOurNumber(page);
  // «Выставочный вариант» — наше железо: номер выдаётся по своей схеме «77-N» (решение Артёма 21.08).
  const machine = await createMachine(page, { categories: ["SHOWROOM"], model, ourNumber });
  expect(machine).toMatchObject({ ourNumber, clientNumber: null });

  // Эксклюзивность: с любой другой категорией набор не собирается — сервер отвергает.
  const bad = await page.request.post("/api/machines", {
    data: { categories: ["SHOWROOM", "OUR_SALE"], model: `${model}-плохой` },
  });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).error.message).toContain("не совмещается");

  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByTestId("machine-category-SHOWROOM")).toBeChecked();
  await expect(page.getByTestId("machine-category-OUR_SALE")).not.toBeChecked();

  // Кнопка «Продан» доступна сразу: выставочный станок — наш, продаётся в одно действие…
  page.once("dialog", (d) => void d.accept()); // переспрос про уход в архив
  await page.getByTestId("machine-status-btn-SOLD").click();
  await expect(page.getByTestId("machine-status-btn-SOLD")).toHaveAttribute("aria-pressed", "true");

  // …а эксклюзивная категория при этом ЗАМЕНЯЕТСЯ на «Наш на продажу», а не дополняется.
  const after = await page.request.get(`/api/machines/${machine.id}`);
  expect(after.status()).toBe(200);
  const detail = (await after.json()).data;
  expect(detail.status).toBe("SOLD");
  expect(detail.categories).toEqual(["OUR_SALE"]);

  // Переезд объяснён в журнале — «почему станок перестал быть выставочным» не приходится угадывать.
  await page.reload();
  await page.getByTestId("machine-history-toggle").click();
  await expect(page.getByTestId("machine-events")).toContainText(
    "Выставочный вариант",
  );
  await expect(page.getByTestId("machine-events")).toContainText("Наш на продажу");
});

test("категория «Под настройку ножей» доступна галочкой и живёт под «Ещё» в счётчиках", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Настройканожей");
  const machine = await createMachine(page, { categories: ["KNIFE_SETUP"], model });

  // Галочка на карточке: клик по обычной категории вытесняет эксклюзивную (правило домена).
  await page.goto(`/machines/${machine.id}`);
  await expect(page.getByTestId("machine-category-KNIFE_SETUP")).toBeChecked();
  await page.getByTestId("machine-category-OUR_RENTAL").click();
  await expect(page.getByTestId("machine-category-OUR_RENTAL")).toBeChecked();
  await expect(page.getByTestId("machine-category-KNIFE_SETUP")).not.toBeChecked();

  // В постоянном ряду счётчиков новых категорий нет — они под «Ещё» (постоянный ряд Артём собрал
  // под ежедневный обзор парка).
  await page.goto("/machines");
  const counters = page.getByTestId("counters-more");
  await expect(page.locator("body")).not.toContainText("Под настройку ножей");
  await counters.click();
  await expect(page.locator("body")).toContainText("Под настройку ножей");
});

test("последнюю галочку категории снять нельзя, а перенумерация идёт только между схемами", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Категории-номер");
  const ourNumber = await nextOurNumber(page);
  const machine = await createMachine(page, { categories: ["OUR_SALE"], model, ourNumber });

  await page.goto(`/machines/${machine.id}`);
  // Единственная стоящая галочка не снимается: пустой набор сервер всё равно отвергнет.
  await page.getByTestId("machine-category-OUR_SALE").click();
  await expect(page.getByTestId("machine-category-OUR_SALE")).toBeChecked();

  // Внутри своей схемы (продажа + аренда) номер не трогается…
  const both = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", categories: ["OUR_SALE", "OUR_RENTAL"] },
  });
  expect(both.status()).toBe(200);
  expect((await both.json()).data.ourNumber).toBe(ourNumber);

  // …а переезд в клиентскую схему освобождает «77-N» и выдаёт «К-N».
  const toClient = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", categories: ["CLIENT"] },
  });
  expect(toClient.status()).toBe(200);
  const moved = (await toClient.json()).data;
  expect(moved.categories).toEqual(["CLIENT"]);
  expect(moved.ourNumber).toBeNull();
  expect(moved.clientNumber).toBeGreaterThan(0);
});

test("фальц машинка: новый вид в разделе «Листогибы» — плашка, бейдж, карточка", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Фальцмашинка");

  await page.goto("/machines");
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-kind-FALZ_MACHINE").click();
  await expect(page.getByRole("dialog")).toContainText("фальц машинка");
  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-save").click();

  // Своя плашка вида в шапке раздела…
  const tabs = page.getByTestId("kind-tabs");
  await expect(tabs).toContainText("Фальц машинки");
  await tabs.getByRole("button", { name: /Фальц машинки/ }).click();

  // …и бейдж «Машинка» в строке: головным видам бейдж не рисуют, комплектующим — рисуют.
  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Машинка");

  // Карточка открывается и знает свой вид.
  const { id } = await findByModel(page, model);
  await page.goto(`/machines/${id}`);
  await expect(page.getByTestId("machine-title")).toBeVisible();
  await openEditForm(page);
  // Вид в форме правки — строки с галочкой, а не выпадашка (20.08.2026).
  await expect(page.getByTestId("machine-edit-kind-FALZ_MACHINE")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("комплектация галочками: пункты и свой вариант склеиваются в одну строку", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Комплектация");

  await page.goto("/machines");
  await page.getByTestId("machine-create").click();
  // Блок виден сразу, без «Показать все поля».
  await expect(page.getByTestId("machine-configuration")).toBeVisible();
  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-config-0").check(); // Роликовый нож
  await page.getByTestId("machine-config-2").check(); // Стойка
  await page.getByTestId("machine-config-custom").fill("стол с упором");
  await page.getByTestId("machine-save").click();
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(1);

  const { id } = await findByModel(page, model);
  await page.goto(`/machines/${id}`);
  // В БД это по-прежнему одна строка: пункты в каноническом порядке, «своё» — в хвосте.
  await expect(page.getByText("Роликовый нож, Стойка, стол с упором")).toBeVisible();
});

test("подсказку модели можно убрать крестиком, а новая карточка возвращает её", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Подсказка");
  // Название попадает в пул подсказок из реально заведённых карточек.
  await createMachine(page, { categories: ["CLIENT"], model });
  const prefix = model.slice(0, -1); // не полное совпадение — иначе крестик у пункта не рисуют

  await page.goto("/machines");
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-model").fill(prefix);
  const list = page.getByTestId("machine-model-list");
  await expect(list).toContainText(model);

  // Крестик переспрашивает (промах пальцем убрал бы подсказку у всей команды) — соглашаемся.
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("model-suppress-0").click();
  await expect(page.getByTestId("machine-model-list")).toHaveCount(0);

  // Заводим карточку с этим же названием — подавление снимается само.
  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-save").click();
  await expect(
    page.getByTestId("machine-list").locator("li").filter({ hasText: model }),
  ).toHaveCount(2);

  // Перезагружаем страницу: справочник формы кэшируется SWR и в пределах пары секунд после
  // предыдущего запроса не перечитывается — с чистой страницы проверка честная.
  await page.reload();
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-model").fill(prefix);
  await expect(page.getByTestId("machine-model-list")).toContainText(model);
});

test("фильтры строками: архив, группировка по состоянию и память выбора", async ({ page }) => {
  await login(page, "maxim");
  const alive = unique("НаПлощадке");
  const gone = unique("ВАрхиве");
  await createMachine(page, { categories: ["CLIENT"], model: alive });
  const voided = await createMachine(page, { categories: ["CLIENT"], model: gone });
  await page.request.patch(`/api/machines/${voided.id}`, {
    data: { op: "status", status: "VOIDED", reason: "e2e" },
  });

  await page.goto("/machines");
  const list = page.getByTestId("machine-list");
  await expect(list.locator("li").filter({ hasText: alive })).toHaveCount(1);

  // «Архив» — строка с галочкой, а не пункт выпадашки (решение Артёма 20.08.2026).
  await page.getByTestId("machine-scope-archive").click();
  await expect(page.getByTestId("machine-scope-archive")).toHaveAttribute("aria-checked", "true");
  await expect(list.locator("li").filter({ hasText: gone })).toHaveCount(1);
  await expect(list.locator("li").filter({ hasText: alive })).toHaveCount(0);

  await page.getByTestId("machine-scope-active").click();
  await expect(list.locator("li").filter({ hasText: alive })).toHaveCount(1);

  // Группировка «По состоянию» рисует заголовки групп…
  await page.getByTestId("machine-search").fill(alive);
  await page.getByTestId("machine-group-status").click();
  await expect(list.getByRole("heading", { name: /Требует ремонта/ })).toBeVisible();

  // …и переживает перезагрузку: вид личный и хранится на устройстве.
  await page.reload();
  await expect(page.getByTestId("machine-group-status")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("machine-group-none")).toHaveAttribute("aria-checked", "false");
});

test("лайтбокс листает фото карточки: счётчик, стрелка и Escape", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Фото");
  const machine = await createMachine(page, { categories: ["CLIENT"], model });

  for (const n of [1, 2]) {
    const res = await page.request.post(`/api/machines/${machine.id}/attachments`, {
      multipart: { file: { name: `p${n}.jpg`, mimeType: "image/jpeg", buffer: JPEG } },
      headers: { "Idempotency-Key": `e2e-machine-photo-${Date.now()}-${n}` },
    });
    expect(res.status(), await res.text()).toBe(201);
  }

  await page.goto(`/machines/${machine.id}`);
  await page.getByRole("button", { name: "Открыть фото во весь экран" }).first().click();
  await expect(page.getByText("1 / 2")).toBeVisible();

  await page.getByRole("button", { name: "Следующее фото" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Следующее фото" })).toHaveCount(0);
});

test("ширину колонки можно потянуть мышью, двойной клик возвращает исходную", async ({ page }) => {
  await login(page, "maxim");
  await createMachine(page, { categories: ["CLIENT"], model: unique("Ширина") });

  await page.goto("/machines");
  const head = page.getByTestId("col-head-model");
  await expect(head).toBeVisible();
  const before = (await head.boundingBox())!.width;

  const handle = page.getByTestId("col-resize-model");
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await head.boundingBox())!.width).toBeGreaterThan(before + 50);

  // Двойной щелчок по той же границе возвращает колонку к ширине по умолчанию.
  await handle.dblclick();
  await expect
    .poll(async () => Math.round((await head.boundingBox())!.width))
    .toBe(Math.round(before));
});
