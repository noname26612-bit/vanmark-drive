import { test, expect, type Page } from "@playwright/test";

// Вкладка «Команда» (PRD §18, 18.08.2026): справочник коллектива — дни рождения и отпуска.
// Проверяем сценарий Милены целиком, права остальных ролей и главный инвариант новой роли
// EMPLOYEE: сотруднику без доступа вход не включить ничем.
//
// БД общая с dev (workers: 1), поэтому имена уникальны по времени, а созданных людей тест за собой
// убирает (деактивирует) — иначе справочник будет расти от прогона к прогону.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";
const today = new Date().toISOString().slice(0, 10);
const plus7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const plus14 = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

type Member = {
  id: string;
  name: string;
  role: string;
  birthday: string | null;
  canLogin: boolean;
  editable: boolean;
};
type Snapshot = {
  members: Member[];
  absences: { id: string; driverId: string; dateFrom: string; dateTo: string }[];
  birthdays: { id: string; name: string; date: string; inDays: number; label: string }[];
  today: string;
};

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function snapshot(page: Page): Promise<Snapshot> {
  const res = await page.request.get("/api/team");
  expect(res.status()).toBe(200);
  return (await res.json()).data as Snapshot;
}

async function memberByName(page: Page, name: string): Promise<Member | undefined> {
  return (await snapshot(page)).members.find((m) => m.name === name);
}

test("Команда: Милена заводит сотрудника без входа, ставит ДР и отпуск", async ({ browser }) => {
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");

  const name = `e2e команда ${Date.now()}`;
  await milena.goto("/team");
  await expect(milena.getByRole("heading", { name: "Команда" })).toBeVisible();

  // Заводим сотрудника через модалку — как это будет делать Милена.
  await milena.locator('[data-testid="add-member"]').click();
  await milena.locator('[data-testid="member-name"]').fill(name);
  await milena.locator('[data-testid="member-birthday"]').fill("1985-08-21");
  await milena.locator('[data-testid="member-birthday"]').press("Enter");
  await milena.locator('[data-testid="member-save"]').click();

  // Появился в таблице с пометкой «без входа».
  const row = milena.locator('[data-testid="member-rows"] tr').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText("без входа");
  await expect(row).toContainText("21 августа");

  const created = await memberByName(milena, name);
  expect(created).toBeTruthy();
  // Роль и вход задаёт сервер, а не форма: справочник коллег не выдаёт доступ в систему.
  expect(created!.role).toBe("EMPLOYEE");
  expect(created!.canLogin).toBe(false);
  expect(created!.birthday).toBe("1985-08-21");

  // Отпуск сотруднику, у которого нет и не было роли водителя, — раньше так было нельзя.
  await milena.locator('[data-testid="add-absence"]').click();
  await milena.locator('[data-testid="absence-member"]').selectOption({ label: name });
  await milena.locator('[data-testid="absence-from"]').fill(plus7);
  await milena.locator('[data-testid="absence-from"]').press("Enter");
  await milena.locator('[data-testid="absence-to"]').fill(plus14);
  await milena.locator('[data-testid="absence-to"]').press("Enter");
  await milena.locator('[data-testid="absence-save"]').click();

  // Ждём именно результат, а не «страница что-то показала»: модалка закрылась и запись видна в
  // блоке отпусков. Без этого следующий запрос уходит наперегонки с сохранением.
  await expect(milena.locator('[data-testid="absence-save"]')).toHaveCount(0);
  await expect(milena.getByText("Запланировано", { exact: true })).toBeVisible();
  await expect(milena.getByText(`${name} · Отпуск`)).toBeVisible();
  const withAbsence = await snapshot(milena);
  const absence = withAbsence.absences.find((a) => a.driverId === created!.id);
  expect(absence).toBeTruthy();

  // Календарь загрузки — про водителей: отпуск цехового сотрудника туда не протекает.
  const cal = (await (await milena.request.get(`/api/capacity/calendar?from=${today}&to=${plus14}`)).json()).data;
  expect(Object.keys(cal.absences ?? {})).not.toContain(created!.id);

  // Убираем за собой: сотрудник исчезает из справочника (мягкая деактивация), а вместе с ним —
  // и его отпуск с экрана: запись в базе остаётся (история), но «призраков» в списке быть не должно.
  expect((await milena.request.delete(`/api/team/${created!.id}`)).status()).toBe(200);
  const after = await snapshot(milena);
  expect(after.members.some((m) => m.name === name)).toBe(false);
  expect(after.absences.some((a) => a.driverId === created!.id)).toBe(false);

  await ctx.close();
});

test("Команда: у учётки с доступом здесь меняется только день рождения", async ({ browser }) => {
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");

  const pisarev = (await snapshot(milena)).members.find((m) => m.name === "Алексей Писарев");
  expect(pisarev).toBeTruthy();
  expect(pisarev!.editable).toBe(false);

  // День рождения — можно.
  const ok = await milena.request.patch(`/api/team/${pisarev!.id}`, { data: { birthday: "1985-03-14" } });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).data.birthday).toBe("1985-03-14");

  // Имя — нельзя: это «Управление», а не справочник коллег.
  const denied = await milena.request.patch(`/api/team/${pisarev!.id}`, { data: { name: "Взлом" } });
  expect(denied.status()).toBe(422);
  expect((await memberByName(milena, "Алексей Писарев"))!.name).toBe("Алексей Писарев");

  // Деактивировать учётку с доступом отсюда тоже нельзя.
  expect((await milena.request.delete(`/api/team/${pisarev!.id}`)).status()).toBe(404);

  // Возвращаем как было (общая dev-БД).
  await milena.request.patch(`/api/team/${pisarev!.id}`, { data: { birthday: "" } });
  await ctx.close();
});

test("Команда: отпуск действующему сотруднику любой роли, внешнему — нет", async ({ browser }) => {
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");
  const members = (await snapshot(milena)).members;

  // Диспетчеру (роль не DRIVER) отпуск теперь заводится — ради этого фича и делалась.
  const self = members.find((m) => m.name === "Милена");
  const created = await milena.request.post("/api/absences", {
    data: { driverId: self!.id, dateFrom: plus7, dateTo: plus7, type: "VACATION", note: "e2e команда" },
  });
  expect(created.status()).toBe(200);
  const absId = (await created.json()).data.id;
  expect((await snapshot(milena)).absences.some((a) => a.id === absId)).toBe(true);
  expect((await milena.request.delete(`/api/absences/${absId}`)).status()).toBe(200);

  // Внешний перевозчик не коллега: в справочнике его нет и отпуска у него не бывает.
  expect(members.some((m) => m.name === "Внешний перевозчик")).toBe(false);
  const cal = (await (await milena.request.get(`/api/capacity/calendar?from=${today}&to=${plus7}`)).json()).data;
  const sultan = (cal.drivers as { id: string; name: string }[]).find((d) => d.name === "Внешний перевозчик");
  if (sultan) {
    const denied = await milena.request.post("/api/absences", {
      data: { driverId: sultan.id, dateFrom: plus7, dateTo: plus7 },
    });
    expect(denied.status()).toBe(422);
  }
  await ctx.close();
});

test("Команда: права ролей — сервисник смотрит, водитель не видит вовсе", async ({ browser }) => {
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  const someone = (await snapshot(milena)).members[0];

  // Менеджер-сервисник: раздел открыт на просмотр, кнопок правки нет.
  const sctx = await browser.newContext();
  const maxim = await sctx.newPage();
  await login(maxim, "maxim");
  await maxim.goto("/team");
  await expect(maxim.getByRole("heading", { name: "Команда" })).toBeVisible();
  await expect(maxim.locator('[data-testid="add-member"]')).toHaveCount(0);
  await expect(maxim.locator('[data-testid="add-absence"]')).toHaveCount(0);
  expect((await maxim.request.get("/api/team")).status()).toBe(200);
  expect((await maxim.request.post("/api/team", { data: { name: "Нельзя" } })).status()).toBe(403);
  expect((await maxim.request.patch(`/api/team/${someone.id}`, { data: { birthday: "1990-01-01" } })).status()).toBe(403);
  expect((await maxim.request.delete(`/api/team/${someone.id}`)).status()).toBe(403);

  // Водитель: ни экрана, ни данных.
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "pisarev");
  expect((await driver.request.get("/api/team")).status()).toBe(403);
  expect((await driver.request.post("/api/team", { data: { name: "Нельзя" } })).status()).toBe(403);
  await driver.goto("/team");
  await expect(driver).toHaveURL(/\/m(\/|$)/);

  await mctx.close();
  await sctx.close();
  await dctx.close();
});

test("Команда: сотруднику без доступа вход не включить ничем", async ({ browser }) => {
  const ctx = await browser.newContext();
  const milena = await ctx.newPage();
  await login(milena, "milena");
  const name = `e2e вход ${Date.now()}`;
  const created = (await (await milena.request.post("/api/team", { data: { name } })).json()).data as Member;
  expect(created.canLogin).toBe(false);

  // Админ: ручка доступа работает только с водителями — сотрудник без входа ей не виден (404).
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");
  const patched = await artem.request.patch("/api/admin/drivers", {
    data: { driverId: created.id, canLogin: true },
  });
  expect(patched.status()).toBe(404);
  // И в списке «Водители — доступ» его нет.
  const access = (await (await artem.request.get("/api/admin/drivers")).json()).data as { id: string }[];
  expect(access.some((d) => d.id === created.id)).toBe(false);

  await milena.request.delete(`/api/team/${created.id}`);
  await ctx.close();
  await actx.close();
});
