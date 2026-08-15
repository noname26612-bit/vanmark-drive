import { test, expect, type Page } from "@playwright/test";

// БЛОКЕР ПРИЁМКИ (PRD §16, ARCHITECTURE §6): изоляция роли SERVICE_MANAGER в ОБЕ СТОРОНЫ.
//
// Риск, ради которого написан этот файл: ввод новой роли в живую систему, где часть проверок могла
// молча означать «не водитель ⇒ штаб». Такой guard пустил бы менеджера-сервисника в KPI и зарплату.
// Поэтому здесь перебираются ВСЕ существующие разделы, а не выборка.
//
// 11.08.2026 граница сдвинулась (решение Артёма): Максиму открыли ЗАЯВКИ — он ставит и ведёт их
// наравне с Миленой. Смены, KPI и нарушения, пометки простоя, «Сводка», расценка и админка остались
// закрытыми. Соответственно и тест теперь проверяет не «закрыто всё», а именно эту границу: что
// разрешено — работает, что запрещено — отказывает.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const thisPeriod = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Страницы, закрытые для менеджера-сервисника: деньги (сводка, KPI, расценка), админка и
// водительские экраны. Каждая обязана увести его на свой стартовый экран.
const FORBIDDEN_PAGES = [
  "/pricing",
  "/summary",
  "/kpi",
  "/admin",
  "/admin/drivers",
  "/admin/pay",
  "/admin/task-types",
  "/admin/work-catalog",
  "/admin/capacity",
  "/m",
  "/m/payroll",
];

// Страницы заявок, открытые ему с 11.08.2026 (проверяем, что доступ реально появился).
// «Сотрудники» (15.08.2026) — тот же контур постановки задач, что и заявки: открыт вместе с ними.
const ALLOWED_PAGES = ["/board", "/planning", "/capacity", "/tasks", "/staff"];

// Ручки, закрытые для менеджера-сервисника. Денежные (KPI, зарплата, сводка, админка) и весь
// контур смен/нарушений — адресно и полным списком: именно они не должны утечь ни при каких
// обстоятельствах, даже теперь, когда роли открыли заявки.
const FORBIDDEN_API: [string, string][] = [
  ["GET", "/api/my/tasks"],
  ["GET", "/api/my/shift"],
  ["GET", "/api/my/kpi"],
  ["GET", `/api/kpi/overview?period=${thisPeriod}`],
  ["POST", "/api/kpi/marks"],
  ["POST", "/api/kpi/detect"],
  ["GET", `/api/summary/overview?granularity=day&date=${today}`],
  ["GET", `/api/summary/export?granularity=day&date=${today}`],
  ["GET", `/api/summary/carrier?granularity=day&date=${today}`],
  ["GET", `/api/summary/shifts?granularity=day&date=${today}`],
  ["GET", `/api/shifts?date=${today}`],
  ["GET", "/api/shifts/stale"],
  ["POST", "/api/shifts/00000000-0000-0000-0000-000000000000/confirm"],
  ["PATCH", "/api/shifts/00000000-0000-0000-0000-000000000000"],
  ["GET", `/api/idle-notes?from=${today}&to=${today}`],
  ["POST", "/api/idle-notes"],
  ["POST", "/api/absences"],
  ["GET", "/api/admin/drivers"],
  ["GET", "/api/admin/pay-profiles"],
  ["GET", "/api/admin/kpi-rules"],
  ["GET", "/api/admin/kpi-settings"],
  ["GET", "/api/admin/task-types"],
  ["GET", "/api/admin/work-catalog"],
  ["GET", "/api/admin/capacity-settings"],
  ["GET", "/api/worksheets/pricing"],
  ["GET", "/api/work-catalog"],
];

// Ручки заявок, открытые ему с 11.08.2026 — обратная половина той же границы.
const ALLOWED_API: string[] = [
  "/api/tasks",
  "/api/staff-performers",
  `/api/board/attention?date=${today}`,
  `/api/capacity/calendar?from=${today}&to=${today}`,
  `/api/absences?from=${today}&to=${today}`,
];

// Все ручки модуля станков: водителю каждая обязана ответить 404 (не 403 — существование модуля
// не раскрываем, та же логика, что с чужой задачей).
const MACHINE_API: [string, string][] = [
  ["GET", "/api/machines"],
  ["GET", "/api/machines?family=SEAMER"],
  ["POST", "/api/machines"],
  ["GET", "/api/machines/meta"],
  ["GET", "/api/machines/00000000-0000-0000-0000-000000000000"],
  ["PATCH", "/api/machines/00000000-0000-0000-0000-000000000000"],
  ["POST", "/api/machines/00000000-0000-0000-0000-000000000000/comments"],
  ["POST", "/api/machines/00000000-0000-0000-0000-000000000000/shop-task"],
  ["GET", "/api/machines/00000000-0000-0000-0000-000000000000/kit"],
  ["POST", "/api/machines/00000000-0000-0000-0000-000000000000/kit"],
  ["DELETE", "/api/machines/00000000-0000-0000-0000-000000000000/kit/00000000-0000-0000-0000-000000000001"],
  ["GET", "/api/machines/photos/00000000-0000-0000-0000-000000000000"],
  ["DELETE", "/api/machines/photos/00000000-0000-0000-0000-000000000000"],
];

test.describe("Изоляция роли: менеджер-сервисник → существующие разделы", () => {
  test("закрытые СТРАНИЦЫ не открываются — уводят на /machines", async ({ page }) => {
    // Много навигаций подряд: в dev каждая страница компилируется при первом заходе, и стандартных
    // 30 секунд на весь тест не хватает (в прод-сборке он проходит за секунды).
    test.setTimeout(120_000);
    await login(page, "maxim");
    await expect(page).toHaveURL(/\/machines$/); // стартовый экран роли

    for (const path of FORBIDDEN_PAGES) {
      await page.goto(path);
      // requireRole/requireAnyRole уводят чужую роль на homeForRole — для Максима это /machines.
      await expect(page, `страница ${path} не должна открываться менеджеру-сервиснику`).toHaveURL(
        /\/machines$/,
      );
    }
  });

  test("страницы заявок, наоборот, открываются (граница 11.08.2026)", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "maxim");
    for (const path of ALLOWED_PAGES) {
      await page.goto(path);
      await expect(page, `страница ${path} должна открываться`).toHaveURL(new RegExp(`${path}$`));
    }
  });

  test("ни одна закрытая РУЧКА не отдаёт данные (деньги, смены, KPI, админка)", async ({ page }) => {
    await login(page, "maxim");

    const leaked: string[] = [];
    for (const [method, url] of FORBIDDEN_API) {
      const res = await page.request.fetch(url, {
        method,
        ...(method === "GET" ? {} : { data: {} }),
      });
      if (res.status() < 400) leaked.push(`${method} ${url} → ${res.status()}`);
    }
    expect(leaked, "менеджер-сервисник не должен попадать в смены, KPI, деньги и админку").toEqual([]);
  });

  test("ручки заявок ему доступны — иначе он не сможет работать", async ({ page }) => {
    await login(page, "maxim");
    for (const url of ALLOWED_API) {
      const res = await page.request.get(url);
      expect(res.status(), `${url} должен быть доступен`).toBe(200);
    }
  });

  test("заводит заявку и ведёт её: создать → назначить → отменить", async ({ page }) => {
    await login(page, "maxim");
    const types = await (await page.request.get("/api/tasks")).json();
    expect(Array.isArray(types.data)).toBe(true);

    // Справочник типов ему закрыт (админка), поэтому typeId берём из уже существующей заявки.
    const anyTask = (types.data as { type: { id: string } }[])[0];
    test.skip(!anyTask, "в базе нет ни одной заявки — нечем взять typeId");

    const created = await page.request.post("/api/tasks", {
      data: {
        typeId: anyTask.type.id,
        title: `Заявка Максима ${Date.now()}`,
        address: "Москва, Ленина 1",
        orgName: "ООО Тест",
        contactName: "Иван",
        contactPhone: "+7 900 000-00-00",
      },
    });
    expect(created.status(), "менеджер-сервисник должен уметь создать заявку").toBe(201);
    const task = (await created.json()).data as { id: string };

    const patched = await page.request.patch(`/api/tasks/${task.id}`, {
      data: { op: "edit", description: "правка от Максима" },
    });
    expect(patched.status()).toBe(200);

    const cancelled = await page.request.post(`/api/tasks/${task.id}/transition`, {
      data: { toStatus: "CANCELLED", comment: "тестовая отмена" },
    });
    expect(cancelled.status()).toBe(200);

    // Убираем за собой: заявка уходит в архив (та же ручка, что и кнопка «В архив»).
    const archived = await page.request.patch(`/api/tasks/${task.id}`, {
      data: { op: "archive", reason: "e2e" },
    });
    expect(archived.status()).toBe(200);
  });

  test("денежные ручки отказывают адресно (403/404, без тела с данными)", async ({ page }) => {
    await login(page, "maxim");

    const money = [
      `/api/kpi/overview?period=${thisPeriod}`,
      "/api/my/kpi",
      "/api/admin/pay-profiles",
      `/api/summary/overview?granularity=day&date=${today}`,
      `/api/summary/export?granularity=day&date=${today}`,
    ];
    for (const url of money) {
      const res = await page.request.get(url);
      expect([403, 404], `${url} должен отказать`).toContain(res.status());
      const body = await res.text();
      expect(body, `${url} не должен возвращать данные`).not.toContain('"data"');
    }
  });
});

test.describe("Изоляция роли: водитель → модуль станков", () => {
  test("страницы оборудования водителю не открываются", async ({ page }) => {
    await login(page, "kashirskiy");
    for (const path of ["/machines", "/seamers"]) {
      await page.goto(path);
      await expect(page, `${path} не должен открываться водителю без доступа`).toHaveURL(/\/m$/);
    }
  });

  test("каждая ручка станков отвечает водителю 404 (не 403)", async ({ page }) => {
    await login(page, "kashirskiy");

    for (const [method, url] of MACHINE_API) {
      const res = await page.request.fetch(url, {
        method,
        ...(method === "GET" || method === "DELETE" ? {} : { data: { category: "CLIENT", model: "x" } }),
      });
      expect(res.status(), `${method} ${url} должен быть 404 для водителя`).toBe(404);
    }
  });

  test("водитель не может загрузить фото в картотеку — единственная ручка, пишущая файл", async ({
    page,
  }) => {
    await login(page, "kashirskiy");
    // Отдельным тестом, потому что это единственный эндпоинт модуля, который буферизует тело,
    // кладёт файл в общий UPLOADS_DIR и пишет в журнал станка: отказ обязан случиться ДО всего этого.
    const res = await page.request.post(
      "/api/machines/00000000-0000-0000-0000-000000000000/attachments",
      {
        multipart: {
          file: {
            name: "x.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
          },
        },
      },
    );
    expect(res.status()).toBe(404);
  });

  test("водитель не заводит станок даже с корректным телом запроса", async ({ page }) => {
    await login(page, "kashirskiy");
    const res = await page.request.post("/api/machines", {
      data: { category: "OUR_SALE", model: "Попытка водителя" },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Доступ к модулю у диспетчера и админа", () => {
  test("Милена работает с картотекой наравне с менеджером-сервисником", async ({ page }) => {
    await login(page, "milena");
    await page.goto("/machines");
    await expect(page.getByRole("heading", { name: "Листогибы" })).toBeVisible();
    expect((await page.request.get("/api/machines")).status()).toBe(200);
  });

  test("админ тоже видит оба раздела, и у него в шапке есть обе вкладки", async ({ page }) => {
    await login(page, "artem");
    await page.goto("/machines");
    await expect(page.getByRole("link", { name: "Листогибы" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Фальцепрокатники" })).toBeVisible();
    expect((await page.request.get("/api/machines?family=BENDER")).status()).toBe(200);
    expect((await page.request.get("/api/machines?family=SEAMER")).status()).toBe(200);
  });
});

// Персональный доступ к оборудованию (решение Артёма 15.08.2026): Николай и Александр — водители,
// которым открыты «Листогибы» и «Фальцепрокатники». Это единственное право не по роли, поэтому
// граница проверяется в ОБЕ стороны: что открылось — работает, что закрыто — по-прежнему закрыто.
test.describe("Персональный доступ к оборудованию: Александр", () => {
  test("видит оба раздела и работает с картотекой", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "alexandr");
    await page.goto("/machines");
    await expect(page.getByRole("heading", { name: "Листогибы" })).toBeVisible();
    await page.goto("/seamers");
    await expect(page.getByRole("heading", { name: "Фальцепрокатники" })).toBeVisible();
    expect((await page.request.get("/api/machines?family=BENDER")).status()).toBe(200);
    expect((await page.request.get("/api/machines?family=SEAMER")).status()).toBe(200);
  });

  test("в меню у него ТОЛЬКО оборудование — ни задач, ни денег", async ({ page }) => {
    await login(page, "alexandr");
    await page.goto("/machines");
    await expect(page.getByRole("link", { name: "Листогибы" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Фальцепрокатники" })).toBeVisible();
    // Подписи — ровно как в dispatcher-nav (16.08.2026: «Сегодня» → «Водители», «Сотрудники» → «Цех»).
    // Список обязан совпадать с меню: устаревшая подпись превращает проверку в ложно-зелёную.
    for (const label of [
      "Водители",
      "Цех",
      "Планирование",
      "Календарь",
      "Все задачи",
      "Сводка",
      "KPI / Зарплата",
      "Управление",
    ]) {
      await expect(page.getByRole("link", { name: label }), `${label} водителю не положен`).toHaveCount(0);
    }
  });

  test("флаг НЕ открывает ему чужие разделы — деньги, смены и админка закрыты", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "alexandr");

    for (const path of ["/board", "/planning", "/tasks", "/summary", "/kpi", "/admin", "/admin/drivers"]) {
      await page.goto(path);
      await expect(page, `${path} водителю с доступом к оборудованию не положен`).toHaveURL(/\/m$/);
    }

    const leaked: string[] = [];
    for (const url of [
      "/api/tasks",
      `/api/kpi/overview?period=${thisPeriod}`,
      `/api/summary/overview?granularity=day&date=${today}`,
      "/api/admin/drivers",
      `/api/shifts?date=${today}`,
    ]) {
      const res = await page.request.get(url);
      if (res.status() < 400) leaked.push(`${url} → ${res.status()}`);
    }
    expect(leaked, "доступ к оборудованию не должен открывать ничего сверх него").toEqual([]);
  });

  test("из своего приложения он попадает в оборудование по ссылке", async ({ page }) => {
    await login(page, "alexandr");
    await page.goto("/m");
    await expect(page.getByTestId("driver-equipment-link")).toBeVisible();
  });

  test("у водителя без доступа такой ссылки нет", async ({ page }) => {
    await login(page, "kashirskiy");
    await page.goto("/m");
    await expect(page.getByTestId("driver-equipment-link")).toHaveCount(0);
  });
});
