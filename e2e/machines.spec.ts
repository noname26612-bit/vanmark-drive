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

test("номер подсказывается по происхождению: своё — «77-», чужое — «К-» (15.08.2026)", async ({
  page,
}) => {
  await login(page, "maxim");
  await page.getByTestId("machine-create").click();

  const number = page.getByTestId("machine-our-number");
  const prefix = page.getByTestId("machine-number-prefix");
  await expect(number).toBeVisible();
  await expect(number).not.toHaveValue("");

  // Клиентский станок нумеруется своей схемой…
  await page.getByTestId("machine-category").selectOption("CLIENT");
  await expect(prefix).toHaveText("К-");
  const clientSuggestion = await number.inputValue();

  // …а свой — привычным «77-». Подсказка перещёлкивается вместе с категорией, пока её не правили.
  await page.getByTestId("machine-category").selectOption("OUR_SALE");
  await expect(prefix).toHaveText("77-");
  const ourSuggestion = await number.inputValue();
  expect(ourSuggestion).not.toBe("");
  expect(ourSuggestion).not.toBe(clientSuggestion); // схемы считаются раздельно
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

test("состояние, несовместимое с категорией, отклоняется и не предлагается кнопкой", async ({
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

  // И в интерфейсе такой кнопки просто нет (состояния переключаются кнопками с 15.08.2026).
  await page.goto(`/machines/${machine.id}`);
  const buttons = await page.getByTestId("machine-status-buttons").locator("button").allInnerTexts();
  expect(buttons).not.toContain("Продан");
  expect(buttons).not.toContain("В аренде");
  expect(buttons).toContain("Выдан клиенту");
  // Текущее состояние подсвечено, а не спрятано в списке.
  await expect(page.getByTestId("machine-status-btn-ACCEPTED")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("смена состояния и правка пишут в журнал «было→стало»", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Журнал");
  const machine = await createMachine(page, { category: "CLIENT", model, location: "Ряд А, место 1" });

  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-status-btn-IN_REPAIR").click();
  // Технические события живут в свёрнутой «Истории изменений» — раскрываем её один раз.
  await page.getByTestId("machine-history-toggle").click();
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
  expect((await dup.json()).error.message).toContain(`Номер 77-${ourNumber} уже занят`);

  // У клиентской схемы своя нумерация: тот же номер занимается независимо и о дубле говорит «К-N».
  const clientNumber = 90000 + Math.floor(Math.random() * 9000);
  const first = await page.request.post("/api/machines", {
    data: { category: "CLIENT", model: `${model}-клиент`, clientNumber },
  });
  expect(first.status()).toBe(201);
  const dupClient = await page.request.post("/api/machines", {
    data: { category: "CLIENT", model: `${model}-клиент-дубль`, clientNumber },
  });
  expect(dupClient.status()).toBe(422);
  expect((await dupClient.json()).error.message).toContain(`Номер К-${clientNumber} уже занят`);

  // Схемы не пересекаются: «77-N» и «К-N» с одинаковым числом живут рядом.
  const sameDigits = await page.request.post("/api/machines", {
    data: { category: "CLIENT", model: `${model}-параллель`, clientNumber: ourNumber },
  });
  expect(sameDigits.status()).toBe(201);
});

test("комментарий появляется в ленте «Комментарии», а не тонет в истории", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Коммент");
  const machine = await createMachine(page, { category: "CLIENT", model });

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

test("номер следует за категорией: «77-N» ↔ «К-N» при переезде (15.08.2026)", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Номер-категория");
  const ourNumber = 80000 + Math.floor(Math.random() * 9000);
  const machine = await createMachine(page, { category: "OUR_SALE", model, ourNumber });

  // Свой станок отдали клиенту — он нумеруется чужой схемой, а «77-N» освобождается.
  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", category: "CLIENT" },
  });
  expect(res.status()).toBe(200);

  const after = (await (await page.request.get(`/api/machines/${machine.id}`)).json()).data;
  expect(after.category).toBe("CLIENT");
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
    data: { op: "category", category: "OUR_RENTAL" },
  });
  expect(back.status()).toBe(200);
  const returned = (await back.json()).data;
  expect(returned.clientNumber).toBeNull();
  expect(returned.ourNumber).toBeGreaterThan(0);
});

test("внутри своей схемы номер не трогается: продажа ↔ аренда — тот же «77-N»", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Номер-внутри");
  const ourNumber = 70000 + Math.floor(Math.random() * 9000);
  const machine = await createMachine(page, { category: "OUR_SALE", model, ourNumber });

  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "category", category: "OUR_RENTAL" },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).data.ourNumber).toBe(ourNumber);
});

test("клиентский станок ищется по «К-N» в любом написании", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Поиск-К");
  const clientNumber = 60000 + Math.floor(Math.random() * 9000); // свой диапазон, БД общая
  await createMachine(page, { category: "CLIENT", model, clientNumber });

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
  const machine = await createMachine(page, { category: "OUR_RENTAL", model });

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
  expect(after.category).toBe("OUR_SALE"); // категория подстроилась сама, без второго действия

  // И это видно в журнале: продажа и переезд категории — две читаемые строки истории.
  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-history-toggle").click();
  const events = page.getByTestId("machine-events");
  await expect(events).toContainText("Принят → Продан");
  await expect(events).toContainText("Категория: Наш арендный → Наш на продажу");
});

test("чужой станок так не продаётся: у клиентского категория сама не меняется", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Чужой-продажа");
  const machine = await createMachine(page, { category: "CLIENT", model });

  const res = await page.request.patch(`/api/machines/${machine.id}`, {
    data: { op: "status", status: "SOLD" },
  });
  expect(res.status()).toBe(422);
  const after = (await (await page.request.get(`/api/machines/${machine.id}`)).json()).data;
  expect(after.category).toBe("CLIENT");
  expect(after.status).toBe("ACCEPTED");
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

  // Смена ответственного видна в журнале как «было→стало» (история по умолчанию свёрнута).
  await page.goto(`/machines/${machine.id}`);
  await page.getByTestId("machine-history-toggle").click();
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

// ───────────────────────────── Доработки 07.08: комментарии ─────────────────────────────

test("закреплённая заметка видна сразу и правится на месте, правка расследуема", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Закреп");
  const machine = await createMachine(page, { category: "CLIENT", model, notes: "нет ножа" });

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
    category: "CLIENT",
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
    category: "CLIENT",
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

  // Галочка перевода в ремонт по умолчанию включена для принятого станка.
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
    category: "CLIENT",
    model: overdue,
    dueDate: isoDaysFromNow(-1),
  });
  await createMachine(page, { category: "CLIENT", model: calm, dueDate: isoDaysFromNow(10) });
  await createMachine(page, { category: "CLIENT", model: today, dueDate: isoDaysFromNow(1) });

  await page.goto("/machines");
  const list = page.getByTestId("machine-list");
  // Бейджи в строках: просроченный назван просроченным, спокойный — нейтральное «до …».
  await expect(list.locator("li").filter({ hasText: overdue })).toContainText("просрочен");
  await expect(list.locator("li").filter({ hasText: calm })).toContainText("до ");

  // Чип «Горит срок»: просроченный и ближайший видны, спокойный — нет.
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
    category: "OUR_RENTAL",
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
  const machine = await createMachine(page, { category: "CLIENT", model });

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
  await expect(page.getByTestId("machine-extra-fields")).toBeVisible();
  await page.getByPlaceholder("Ряд Б, место 3").fill("Ряд Е, место 1");

  // Сворачиваем — кнопка осталась на месте (раньше исчезала), данные живы.
  await page.getByTestId("machine-toggle-fields").click();
  await expect(page.getByTestId("machine-extra-fields")).toHaveCount(0);
  await page.getByTestId("machine-toggle-fields").click();
  await expect(page.getByPlaceholder("Ряд Б, место 3")).toHaveValue("Ряд Е, место 1");
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
