import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// Календарь загрузки (этап 17, PRD §14.4). Геокодер в e2e выключен → оценка = норма типа (без дороги).
// Проверяем изоляцию ручки (только Д/А) и суммирование оценок по (водитель, день) дельтой.

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function calendar(req: APIRequestContext, from: string, to: string) {
  const res = await req.get(`/api/capacity/calendar?from=${from}&to=${to}`);
  return { status: res.status(), body: res.ok() ? (await res.json()).data : null };
}

test("календарь: доступ только диспетчеру/админу", async ({ browser }) => {
  test.slow();
  const today = localKey(new Date());
  const to = localKey(new Date(Date.now() + 13 * 86400000));

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const okCal = await calendar(milena.request, today, to);
  expect(okCal.status).toBe(200);
  expect(okCal.body.days.length).toBe(14);
  expect(okCal.body.drivers.length).toBeGreaterThanOrEqual(2);

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");
  expect((await calendar(driver.request, today, to)).status).toBe(403);

  const gctx = await browser.newContext();
  expect((await calendar(gctx.request, today, to)).status).toBe(401);

  await mctx.close();
  await dctx.close();
  await gctx.close();
});

test("календарь: суммирует оценки и считает задачи по дню/водителю", async ({ browser }) => {
  test.slow();
  // тип задачи берём через админа
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");
  const types = (await (await artem.request.get("/api/admin/task-types")).json()).data as { id: string; name: string }[];
  const repairId = types.find((t) => t.name === "Выездной ремонт / диагностика")!.id;

  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");

  // уникальный день в пределах горизонта (today+11), чтобы не пересекаться с другими тестами
  const day = localKey(new Date(Date.now() + 11 * 86400000));
  const from = localKey(new Date());
  const to = localKey(new Date(Date.now() + 13 * 86400000));

  const before = await calendar(milena.request, from, to);
  const kid = (before.body.drivers as { id: string; name: string }[]).find(
    (d) => d.name === "Алексей Каширский",
  )!.id;
  const cellBefore = before.body.cells[kid]?.[day] ?? { minutes: 0, count: 0 };

  // две задачи на этого водителя в этот день
  const mk = async () =>
    (
      await milena.request.post("/api/tasks", {
        data: { typeId: repairId, title: `e2e cal ${Date.now()}-${Math.random()}`, address: "Адрес e2e", scheduledDate: day, assigneeId: kid },
      })
    ).json();
  const t1 = (await mk()).data;
  const t2 = (await mk()).data;
  const addedMinutes = (t1.estimatedMinutes ?? 0) + (t2.estimatedMinutes ?? 0);
  expect(addedMinutes).toBeGreaterThan(0);

  const after = await calendar(milena.request, from, to);
  const cellAfter = after.body.cells[kid][day];
  expect(cellAfter.count - cellBefore.count).toBe(2);
  expect(cellAfter.minutes - cellBefore.minutes).toBe(addedMinutes);

  // страница календаря рендерит сетку
  await milena.goto("/capacity");
  await expect(milena.getByTestId("capacity-grid")).toBeVisible();

  await actx.close();
  await mctx.close();
});
