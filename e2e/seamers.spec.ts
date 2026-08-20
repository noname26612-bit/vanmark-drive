import { test, expect, type Page } from "@playwright/test";

// Раздел «Фальцепрокатники» и комплектация (решения Артёма 15.08.2026). Проверяется то, чего не
// было в картотеке раньше: раздельная нумерация, складские остатки количеством и комплект, который
// уезжает вместе с головным станком.
//
// Правка 20.08.2026: категории приходят списком, «Принят» выведен из оборота, порядок и
// группировка переключаются строками с галочкой (выпадающих списков в разделе больше нет).
//
// Тесты делят общую dev-БД, поэтому каждая карточка помечается уникальной моделью и ищется по ней.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

type Machine = { id: string; ourNumber: number | null; quantity: number; freeQuantity: number };

async function create(page: Page, data: Record<string, unknown>): Promise<Machine> {
  const res = await page.request.post("/api/machines", { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data;
}

/**
 * Следующий свободный номер раздела. Тесты делят общую dev-БД и гоняются многократно, поэтому
 * случайный номер из фиксированного диапазона рано или поздно ловит занятый и падает на дубле.
 * Спрашиваем у сервера — он и так подсказывает его форме.
 */
async function nextNumber(page: Page, family: string): Promise<number> {
  const res = await page.request.get(`/api/machines/meta?family=${family}`);
  expect(res.status()).toBe(200);
  return (await res.json()).data.nextOurNumber;
}

async function read(page: Page, id: string): Promise<Machine & Record<string, unknown>> {
  const res = await page.request.get(`/api/machines/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()).data;
}

test("нумерация 77-N своя в каждом разделе: один номер живёт и у листогиба, и у фальцепрокатника", async ({
  page,
}) => {
  await login(page, "maxim");
  // Берём номер, свободный в ОБОИХ разделах: так тест не зависит от того, что накопили соседние.
  const number = Math.max(await nextNumber(page, "BENDER"), await nextNumber(page, "SEAMER"));

  const bender = await create(page, {
    family: "BENDER",
    kind: "MACHINE",
    categories: ["OUR_SALE"],
    model: unique("Листогиб-нумерация"),
    ourNumber: number,
  });
  const seamer = await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    categories: ["OUR_SALE"],
    model: unique("Фальц-нумерация"),
    ourNumber: number,
  });

  expect(bender.ourNumber).toBe(number);
  expect(seamer.ourNumber).toBe(number);

  // А вот внутри раздела номер по-прежнему один: дубль ловится человеческой ошибкой, а не 500.
  const dup = await page.request.post("/api/machines", {
    data: {
      family: "SEAMER",
      kind: "SEAMER",
      categories: ["OUR_SALE"],
      model: unique("Фальц-дубль"),
      ourNumber: number,
    },
  });
  expect(dup.status()).toBe(422);
  expect((await dup.json()).error.message).toContain("фальцепрокатники");
});

test("разделы не смешиваются: подсказка номера и список — каждый про своё", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Фальц-раздел");
  await create(page, { family: "SEAMER", kind: "SEAMER", categories: ["OUR_SALE"], model });

  const benderList = await (await page.request.get("/api/machines?family=BENDER")).json();
  const seamerList = await (await page.request.get("/api/machines?family=SEAMER")).json();
  expect(benderList.data.machines.some((m: { model: string }) => m.model === model)).toBe(false);
  expect(seamerList.data.machines.some((m: { model: string }) => m.model === model)).toBe(true);

  // Подсказка следующего свободного номера считается по своему разделу: заняли большой номер у
  // фальцепрокатников — подсказка листогибов не сдвинулась. (Сравнивать две подсказки между собой
  // бессмысленно: они могут совпасть случайно.)
  const benderBefore = await nextNumber(page, "BENDER");
  const seamerBefore = await nextNumber(page, "SEAMER");
  await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    categories: ["OUR_SALE"],
    model: unique("Фальц-подсказка"),
    ourNumber: seamerBefore,
  });
  expect(await nextNumber(page, "BENDER")).toBe(benderBefore);
  expect(await nextNumber(page, "SEAMER")).toBe(seamerBefore + 1);
});

test("складской остаток: размотчик ведётся количеством, без состояния и категории", async ({
  page,
}) => {
  await login(page, "maxim");
  const model = unique("Размотчик");
  const stock = await create(page, { family: "SEAMER", kind: "UNCOILER", model, quantity: 4 });
  expect(stock.quantity).toBe(4);
  expect(stock.freeQuantity).toBe(4);

  // Состояния у остатка нет — попытка его сменить отклоняется понятным текстом.
  const status = await page.request.patch(`/api/machines/${stock.id}`, {
    data: { op: "status", status: "IN_REPAIR" },
  });
  expect(status.status()).toBe(422);
  expect((await status.json()).error.message).toContain("складских остатков");

  // Категории — тоже нет.
  const category = await page.request.patch(`/api/machines/${stock.id}`, {
    data: { op: "category", categories: ["CLIENT"] },
  });
  expect(category.status()).toBe(422);

  await page.goto("/seamers");
  await page.getByTestId("kind-tabs").getByRole("button", { name: /Размотчики/ }).click();
  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("4 шт");
});

test("складской остаток заводится ФОРМОЙ: ни категорий, ни номера у него не спрашивают", async ({
  page,
}) => {
  // Регрессия 20.08.2026: форма прятала у складского вида категории и номер, но продолжала слать
  // их в теле — сервер ставит складским свою категорию принудительно и отвечал «Номер «77-N» —
  // для категорий «Наш на продажу»». Размотчик не заводился вообще, а человек видел ошибку про
  // номер, которого не вводил.
  await login(page, "maxim");
  const model = unique("Размотчик-форма");

  await page.goto("/seamers");
  await page.getByTestId("machine-create").click();
  await page.getByTestId("machine-kind-UNCOILER").click();
  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-quantity").fill("5");
  await page.getByTestId("machine-save").click();

  // Модалка закрылась — значит карточка сохранилась, а не упала на валидации номера.
  await expect(page.getByTestId("machine-save")).toBeHidden();

  const list = await page.request.get("/api/machines?family=SEAMER&scope=active&kind=UNCOILER");
  const created = (await list.json()).data.machines.find(
    (m: { model: string }) => m.model === model,
  );
  expect(created).toBeTruthy();
  expect(created.quantity).toBe(5);
  // Категорию и состояние складским ставит сервер, номер не выдаётся вовсе.
  expect(created.categories).toEqual(["OUR_SALE"]);
  expect(created.status).toBe("READY");
  expect(created.ourNumber).toBeNull();
  expect(created.clientNumber).toBeNull();
});

test("комплект: размотчик резервируется под фальцепрокатник, а продажа списывает его со склада", async ({
  page,
}) => {
  await login(page, "maxim");
  const seamer = await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    categories: ["OUR_SALE"],
    model: unique("Фальц-комплект"),
  });
  const stock = await create(page, {
    family: "SEAMER",
    kind: "UNCOILER",
    model: unique("Размотчик-комплект"),
    quantity: 5,
  });

  // Кандидатом в комплект складская позиция видна со своим свободным остатком.
  const candidates = await (await page.request.get(`/api/machines/${seamer.id}/kit`)).json();
  const candidate = candidates.data.find((c: { id: string }) => c.id === stock.id);
  expect(candidate.free).toBe(5);

  const attached = await page.request.post(`/api/machines/${seamer.id}/kit`, {
    data: { partId: stock.id, qty: 2 },
  });
  expect(attached.status()).toBe(201);

  // Приписанные штуки заняты, хотя станок ещё стоит на площадке: иначе один размотчик уехал бы
  // в составе трёх разных комплектов.
  const reserved = await read(page, stock.id);
  expect(reserved.quantity).toBe(5);
  expect(reserved.freeQuantity).toBe(3);

  // Больше свободного остатка не приписать.
  const tooMany = await page.request.post(`/api/machines/${seamer.id}/kit`, {
    data: { partId: stock.id, qty: 9 },
  });
  expect(tooMany.status()).toBe(422);

  // Продажа с комплектом списывает штуки один раз.
  const sold = await page.request.patch(`/api/machines/${seamer.id}`, {
    data: { op: "status", status: "SOLD", withKit: true },
  });
  expect(sold.status()).toBe(200);

  const afterSale = await read(page, stock.id);
  expect(afterSale.quantity).toBe(3);
  expect(afterSale.freeQuantity).toBe(3);

  // Возврат станка из архива и повторная продажа остаток второй раз не трогают: связь списана.
  // (READY, а не «Принят»: последний выведен из оборота 20.08.2026.)
  await page.request.patch(`/api/machines/${seamer.id}`, { data: { op: "status", status: "READY" } });
  await page.request.patch(`/api/machines/${seamer.id}`, {
    data: { op: "status", status: "SOLD", withKit: true },
  });
  const afterSecondSale = await read(page, stock.id);
  expect(afterSecondSale.quantity).toBe(3);
});

test("комплект листогиба: нож переходит в ремонт вместе со станком и не берётся дважды", async ({
  page,
}) => {
  await login(page, "maxim");
  const bender = await create(page, {
    family: "BENDER",
    kind: "MACHINE",
    categories: ["OUR_SALE"],
    model: unique("Листогиб-комплект"),
  });
  const other = await create(page, {
    family: "BENDER",
    kind: "MACHINE",
    categories: ["OUR_SALE"],
    model: unique("Листогиб-второй"),
  });
  const knife = await create(page, {
    family: "BENDER",
    kind: "ROLLER_KNIFE",
    categories: ["OUR_SALE"],
    model: unique("Нож-комплект"),
  });

  expect((await page.request.post(`/api/machines/${bender.id}/kit`, { data: { partId: knife.id } })).status()).toBe(201);

  // Тот же нож во второй комплект не встаёт — он физически один.
  const second = await page.request.post(`/api/machines/${other.id}/kit`, {
    data: { partId: knife.id },
  });
  expect(second.status()).toBe(422);
  expect((await second.json()).error.message).toContain("уже стоит в другом комплекте");

  // Ремонт головного переводит и нож — они уезжают в цех вместе.
  await page.request.patch(`/api/machines/${bender.id}`, {
    data: { op: "status", status: "IN_REPAIR", withKit: true },
  });
  expect((await read(page, knife.id)).status).toBe("IN_REPAIR");

  // Без галочки состояние ножа не трогается — человек мог оставить его на площадке.
  await page.request.patch(`/api/machines/${bender.id}`, {
    data: { op: "status", status: "READY", withKit: false },
  });
  expect((await read(page, knife.id)).status).toBe("IN_REPAIR");

  // Разобранный комплект освобождает нож.
  expect((await page.request.delete(`/api/machines/${bender.id}/kit/${knife.id}`)).status()).toBe(200);
  const freed = await page.request.post(`/api/machines/${other.id}/kit`, { data: { partId: knife.id } });
  expect(freed.status()).toBe(201);
});

test("комплект собирается только внутри своего раздела", async ({ page }) => {
  await login(page, "maxim");
  const bender = await create(page, {
    family: "BENDER",
    kind: "MACHINE",
    categories: ["OUR_SALE"],
    model: unique("Листогиб-чужой"),
  });
  const stock = await create(page, {
    family: "SEAMER",
    kind: "UNCOILER",
    model: unique("Размотчик-чужой"),
    quantity: 2,
  });

  const res = await page.request.post(`/api/machines/${bender.id}/kit`, {
    data: { partId: stock.id, qty: 1 },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toContain("другого раздела");
});

test("список не прыгает после правки: порядок по учётному номеру, а не по дате изменения", async ({
  page,
}) => {
  await login(page, "maxim");
  // Три карточки подряд идущими номерами: правка средней не должна менять их порядок.
  const base = await nextNumber(page, "SEAMER");
  const tag = unique("Порядок");
  const made: Machine[] = [];
  for (const i of [0, 1, 2]) {
    made.push(
      await create(page, {
        family: "SEAMER",
        kind: "SEAMER",
        categories: ["OUR_SALE"],
        model: `${tag}-${i}`,
        ourNumber: base + i,
      }),
    );
  }

  const orderOf = async (): Promise<string[]> => {
    const list = await (await page.request.get("/api/machines?family=SEAMER")).json();
    return list.data.machines
      .filter((m: { model: string }) => m.model.startsWith(tag))
      .map((m: { model: string }) => m.model);
  };

  expect(await orderOf()).toEqual([`${tag}-0`, `${tag}-1`, `${tag}-2`]);

  // Правим среднюю — раньше она улетала наверх (сортировка по updatedAt). «Место на площадке» из
  // карточки убрали 20.08.2026, поэтому правим оставшееся поле.
  await page.request.patch(`/api/machines/${made[1].id}`, {
    data: { op: "edit", metalThickness: "0,7 мм" },
  });
  expect(await orderOf()).toEqual([`${tag}-0`, `${tag}-1`, `${tag}-2`]);

  // Порядок переключается строкой «Сначала большие» — выпадашки убраны 20.08.2026.
  await page.goto("/seamers");
  await page.getByTestId("machine-search").fill(tag);
  const rows = page.getByTestId("machine-list").locator("li");
  await expect(rows.first()).toContainText(`${tag}-0`);
  await page.getByTestId("machine-direction-desc").click();
  await expect(rows.first()).toContainText(`${tag}-2`);
});

test("группировка по состоянию раскладывает список заголовками", async ({ page }) => {
  await login(page, "maxim");
  const tag = unique("Группы");
  const ready = await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    categories: ["OUR_SALE"],
    model: `${tag}-готов`,
  });
  // Новая карточка заводится в «Требует ремонта»: «Принят» выведен из оборота 20.08.2026.
  await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    categories: ["OUR_SALE"],
    model: `${tag}-ремонт`,
  });
  await page.request.patch(`/api/machines/${ready.id}`, { data: { op: "status", status: "READY" } });

  await page.goto("/seamers");
  await page.getByTestId("machine-search").fill(tag);
  await page.getByTestId("machine-group-status").click();

  const list = page.getByTestId("machine-list");
  await expect(list.getByRole("heading", { name: /Готов/ })).toBeVisible();
  await expect(list.getByRole("heading", { name: /Требует ремонта/ })).toBeVisible();
});

test("комплектация фальцепрокатника набирается галочками своего раздела", async ({ page }) => {
  await login(page, "maxim");
  const model = unique("Фальц-комплектация");

  await page.goto("/seamers");
  await page.getByTestId("machine-create").click();
  // Пункты — свои у каждого раздела: у фальцепрокатника это размотчик и частотник.
  const config = page.getByTestId("machine-configuration");
  await expect(config).toContainText("Размотчик");
  await expect(config).toContainText("Частотник");

  await page.getByTestId("machine-model").fill(model);
  await page.getByTestId("machine-config-1").check(); // Частотник
  await page.getByTestId("machine-config-custom").fill("длинный стол");
  await page.getByTestId("machine-save").click();

  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);

  const list = await (await page.request.get("/api/machines?family=SEAMER")).json();
  const created = (list.data.machines as { id: string; model: string }[]).find(
    (m) => m.model === model,
  );
  expect(created, "карточка должна быть в разделе").toBeTruthy();
  await page.goto(`/seamers/${created!.id}`);
  // В БД это одна строка: пункт в каноническом виде, «своё» — в хвосте.
  await expect(page.getByText("Частотник, длинный стол")).toBeVisible();
});
