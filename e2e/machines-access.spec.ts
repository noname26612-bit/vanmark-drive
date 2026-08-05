import { test, expect, type Page } from "@playwright/test";

// БЛОКЕР ПРИЁМКИ этапа «Станки» (PRD §16, ARCHITECTURE §6): изоляция новой роли SERVICE_MANAGER
// проверяется В ОБЕ СТОРОНЫ.
//
// Риск, ради которого написан этот файл: ввод новой роли в живую систему, где часть проверок могла
// молча означать «не водитель ⇒ штаб». Такой guard пустил бы менеджера-сервисника в задачи, KPI и
// зарплату. Поэтому здесь перебираются ВСЕ существующие разделы, а не выборка.
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

// Все страницы существующих разделов: ни одна не должна открыться менеджеру-сервиснику.
const EXISTING_PAGES = [
  "/board",
  "/planning",
  "/capacity",
  "/tasks",
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

// Существующие ручки. Денежные (KPI, зарплата, сводка, админка) — адресно и полным списком:
// именно они не должны утечь новой роли ни при каких обстоятельствах.
const EXISTING_API: [string, string][] = [
  ["GET", "/api/tasks"],
  ["POST", "/api/tasks"],
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
  ["GET", "/api/board/attention"],
  ["GET", `/api/capacity/calendar?from=${today}&to=${today}`],
  ["GET", "/api/absences"],
  ["GET", `/api/idle-notes?from=${today}&to=${today}`],
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

// Все ручки модуля станков: водителю каждая обязана ответить 404 (не 403 — существование модуля
// не раскрываем, та же логика, что с чужой задачей).
const MACHINE_API: [string, string][] = [
  ["GET", "/api/machines"],
  ["POST", "/api/machines"],
  ["GET", "/api/machines/meta"],
  ["GET", "/api/machines/00000000-0000-0000-0000-000000000000"],
  ["PATCH", "/api/machines/00000000-0000-0000-0000-000000000000"],
  ["POST", "/api/machines/00000000-0000-0000-0000-000000000000/comments"],
  ["GET", "/api/machines/photos/00000000-0000-0000-0000-000000000000"],
  ["DELETE", "/api/machines/photos/00000000-0000-0000-0000-000000000000"],
];

test.describe("Изоляция роли: менеджер-сервисник → существующие разделы", () => {
  test("ни одна существующая СТРАНИЦА не открывается — уводит на /machines", async ({ page }) => {
    await login(page, "maxim");
    await expect(page).toHaveURL(/\/machines$/); // стартовый экран роли

    for (const path of EXISTING_PAGES) {
      await page.goto(path);
      // requireRole/requireAnyRole уводят чужую роль на homeForRole — для Максима это /machines.
      await expect(page, `страница ${path} не должна открываться менеджеру-сервиснику`).toHaveURL(
        /\/machines$/,
      );
    }
  });

  test("ни одна существующая РУЧКА не отдаёт данные (включая деньги)", async ({ page }) => {
    await login(page, "maxim");

    const leaked: string[] = [];
    for (const [method, url] of EXISTING_API) {
      const res = await page.request.fetch(url, {
        method,
        ...(method === "GET" ? {} : { data: {} }),
      });
      if (res.status() < 400) leaked.push(`${method} ${url} → ${res.status()}`);
    }
    expect(leaked, "новая роль не должна получать доступ ни к одной существующей ручке").toEqual([]);
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
  test("страница /machines водителю не открывается", async ({ page }) => {
    await login(page, "kashirskiy");
    await page.goto("/machines");
    await expect(page).toHaveURL(/\/m$/); // ушёл на свой экран
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
    await expect(page.getByRole("heading", { name: "Станки" })).toBeVisible();
    expect((await page.request.get("/api/machines")).status()).toBe(200);
  });

  test("админ тоже видит картотеку, и у него в шапке есть вкладка «Станки»", async ({ page }) => {
    await login(page, "artem");
    await page.goto("/machines");
    await expect(page.getByRole("link", { name: "Станки" })).toBeVisible();
    expect((await page.request.get("/api/machines")).status()).toBe(200);
  });
});
