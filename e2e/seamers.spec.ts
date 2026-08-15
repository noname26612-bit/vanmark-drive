import { test, expect, type Page } from "@playwright/test";

// Раздел «Фальцепрокатники» и комплектация (решения Артёма 15.08.2026). Проверяется то, чего не
// было в картотеке раньше: раздельная нумерация, складские остатки количеством и комплект, который
// уезжает вместе с головным станком.
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

async function read(page: Page, id: string): Promise<Machine & Record<string, unknown>> {
  const res = await page.request.get(`/api/machines/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()).data;
}

test("нумерация 77-N своя в каждом разделе: один номер живёт и у листогиба, и у фальцепрокатника", async ({
  page,
}) => {
  await login(page, "maxim");
  // Берём заведомо свободный номер в обоих разделах, чтобы не конфликтовать с данными других тестов.
  const number = 60000 + Math.floor(Math.random() * 9000);

  const bender = await create(page, {
    family: "BENDER",
    kind: "MACHINE",
    category: "OUR_SALE",
    model: unique("Листогиб-нумерация"),
    ourNumber: number,
  });
  const seamer = await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    category: "OUR_SALE",
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
      category: "OUR_SALE",
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
  await create(page, { family: "SEAMER", kind: "SEAMER", category: "OUR_SALE", model });

  const benderList = await (await page.request.get("/api/machines?family=BENDER")).json();
  const seamerList = await (await page.request.get("/api/machines?family=SEAMER")).json();
  expect(benderList.data.machines.some((m: { model: string }) => m.model === model)).toBe(false);
  expect(seamerList.data.machines.some((m: { model: string }) => m.model === model)).toBe(true);

  // Подсказка следующего свободного номера считается по своему разделу.
  const benderMeta = await (await page.request.get("/api/machines/meta?family=BENDER")).json();
  const seamerMeta = await (await page.request.get("/api/machines/meta?family=SEAMER")).json();
  expect(benderMeta.data.nextOurNumber).not.toBe(seamerMeta.data.nextOurNumber);
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
    data: { op: "category", category: "CLIENT" },
  });
  expect(category.status()).toBe(422);

  await page.goto("/seamers");
  await page.getByTestId("kind-tabs").getByRole("button", { name: /Размотчики/ }).click();
  const row = page.getByTestId("machine-list").locator("li").filter({ hasText: model });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("4 шт");
});

test("комплект: размотчик резервируется под фальцепрокатник, а продажа списывает его со склада", async ({
  page,
}) => {
  await login(page, "maxim");
  const seamer = await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    category: "OUR_SALE",
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
    category: "OUR_SALE",
    model: unique("Листогиб-комплект"),
  });
  const other = await create(page, {
    family: "BENDER",
    kind: "MACHINE",
    category: "OUR_SALE",
    model: unique("Листогиб-второй"),
  });
  const knife = await create(page, {
    family: "BENDER",
    kind: "ROLLER_KNIFE",
    category: "OUR_SALE",
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
    category: "OUR_SALE",
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
  const base = 50000 + Math.floor(Math.random() * 900);
  const tag = unique("Порядок");
  const made: Machine[] = [];
  for (const i of [0, 1, 2]) {
    made.push(
      await create(page, {
        family: "SEAMER",
        kind: "SEAMER",
        category: "OUR_SALE",
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

  // Правим среднюю — раньше она улетала наверх (сортировка по updatedAt).
  await page.request.patch(`/api/machines/${made[1].id}`, {
    data: { op: "edit", location: "Ангар 3" },
  });
  expect(await orderOf()).toEqual([`${tag}-0`, `${tag}-1`, `${tag}-2`]);

  // Переключатель направления переворачивает список — и это единственный способ сменить порядок.
  await page.goto("/seamers");
  await page.getByTestId("machine-search").fill(tag);
  const rows = page.getByTestId("machine-list").locator("li");
  await expect(rows.first()).toContainText(`${tag}-0`);
  await page.getByTestId("machine-direction").click();
  await expect(rows.first()).toContainText(`${tag}-2`);
});

test("группировка по состоянию раскладывает список заголовками", async ({ page }) => {
  await login(page, "maxim");
  const tag = unique("Группы");
  const ready = await create(page, {
    family: "SEAMER",
    kind: "SEAMER",
    category: "OUR_SALE",
    model: `${tag}-готов`,
  });
  await create(page, { family: "SEAMER", kind: "SEAMER", category: "OUR_SALE", model: `${tag}-принят` });
  await page.request.patch(`/api/machines/${ready.id}`, { data: { op: "status", status: "READY" } });

  await page.goto("/seamers");
  await page.getByTestId("machine-search").fill(tag);
  await page.getByTestId("machine-group-by").selectOption("status");

  const list = page.getByTestId("machine-list");
  await expect(list.getByRole("heading", { name: /Готов/ })).toBeVisible();
  await expect(list.getByRole("heading", { name: /Принят/ })).toBeVisible();
});
