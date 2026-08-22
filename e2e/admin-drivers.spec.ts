// Админка «Пользователи и доступ» (03.08 — водители, 22.08.2026 — учётки офиса): вход, признак
// «внешний перевозчик», смена пароля. Раньше пароль офиса менялся только запросом к базе.
// ВАЖНО: e2e делят одну dev-БД — все изменения флагов и паролей тест обязан вернуть назад.
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

type AccessRow = {
  id: string;
  login: string;
  name: string;
  role: string;
  isExternal: boolean;
  canLogin: boolean;
};

async function accessList(page: Page): Promise<AccessRow[]> {
  const res = await page.request.get("/api/admin/drivers");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: AccessRow[] }).data;
}

async function driverByLogin(page: Page, driverLogin: string): Promise<{ id: string; isExternal: boolean }> {
  const found = (await accessList(page)).find((d) => d.login === driverLogin);
  if (!found) throw new Error(`водитель ${driverLogin} не найден`);
  return { id: found.id, isExternal: found.isExternal };
}

test("изоляция: диспетчеру и водителю админ-ручки недоступны", async ({ browser }) => {
  for (const who of ["milena", "kashirskiy"]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, who);
    expect((await page.request.get("/api/admin/drivers")).status()).toBe(403);
    expect(
      (await page.request.patch("/api/admin/drivers", { data: { driverId: "x", isExternal: true } })).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/admin/drivers/password", {
          data: { driverId: "x", newPassword: "vanmark2026" },
        })
      ).status(),
    ).toBe(403);
    await ctx.close();
  }
});

test("админ переключает признак «внешний» и возвращает обратно", async ({ page }) => {
  await login(page, "artem");
  const before = await driverByLogin(page, "nikolay");

  const on = await page.request.patch("/api/admin/drivers", {
    data: { driverId: before.id, isExternal: !before.isExternal },
  });
  expect(on.status()).toBe(200);
  expect(((await on.json()) as { data: { isExternal: boolean } }).data.isExternal).toBe(!before.isExternal);

  // Возвращаем исходное состояние — общая dev-БД.
  const back = await page.request.patch("/api/admin/drivers", {
    data: { driverId: before.id, isExternal: before.isExternal },
  });
  expect(back.status()).toBe(200);
  expect((await driverByLogin(page, "nikolay")).isExternal).toBe(before.isExternal);
});

test("несуществующий пользователь, два действия сразу и слабый пароль — отказ", async ({ page }) => {
  await login(page, "artem");
  const driver = await driverByLogin(page, "nikolay");

  const foreign = await page.request.post("/api/admin/drivers/password", {
    data: { userId: "00000000-0000-0000-0000-000000000000", newPassword: "vanmark2026" },
  });
  expect(foreign.status()).toBe(404);

  const both = await page.request.patch("/api/admin/drivers", {
    data: { driverId: driver.id, canLogin: true, isExternal: true },
  });
  expect([400, 422]).toContain(both.status());

  const weak = await page.request.post("/api/admin/drivers/password", {
    data: { driverId: driver.id, newPassword: "123" },
  });
  expect([400, 422]).toContain(weak.status());
});

test("смена пароля: водитель входит новым паролем, затем пароль возвращается", async ({ browser }) => {
  test.slow();
  const actx = await browser.newContext();
  const admin = await actx.newPage();
  await login(admin, "artem");
  const driver = await driverByLogin(admin, "nikolay");
  const temporary = `e2e-${Date.now()}`;

  const set = await admin.request.post("/api/admin/drivers/password", {
    data: { driverId: driver.id, newPassword: temporary },
  });
  expect(set.status()).toBe(200);
  // В ответе секретов нет.
  expect(JSON.stringify(await set.json())).not.toContain(temporary);

  try {
    // Водитель входит новым паролем и попадает в своё приложение.
    const dctx = await browser.newContext();
    const driverPage = await dctx.newPage();
    await login(driverPage, "nikolay", temporary);
    await expect(driverPage).toHaveURL(/\/m$/);
    await dctx.close();
  } finally {
    // Возвращаем прежний пароль — общая dev-БД и общий ростер.
    const restore = await admin.request.post("/api/admin/drivers/password", {
      data: { driverId: driver.id, newPassword: PASSWORD },
    });
    expect(restore.status()).toBe(200);
  }
  await actx.close();
});

test("UI админки: бейджи и модалка смены пароля", async ({ page }) => {
  await login(page, "artem");
  await page.goto("/admin/drivers");

  // Николай — подменный: без оклада и не внешний.
  const nikolay = page.locator("li").filter({ hasText: "Николай" }).first();
  await expect(nikolay).toContainText("Без расчёта");
  // Внешний перевозчик помечен своим бейджем.
  await expect(page.locator("li").filter({ hasText: "Внешний перевозчик" }).first()).toContainText(
    "Внешний",
  );

  await nikolay.getByTestId("driver-password").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("driver-password-value").fill("vanmark2026");
  await page.getByTestId("driver-password-repeat").fill("другой-пароль");
  await page.getByTestId("driver-password-save").click();
  await expect(page.getByRole("dialog")).toContainText("не совпадают");
});

// ─── Учётки офиса (22.08.2026, решение Артёма) ───

test("список доступа: офис виден, сотрудник без входа (EMPLOYEE) — нет", async ({ page }) => {
  await login(page, "artem");
  const rows = await accessList(page);
  // Милена, Максим и админы — в списке; у каждого есть роль.
  expect(rows.some((r) => r.login === "milena" && r.role === "DISPATCHER")).toBe(true);
  expect(rows.some((r) => r.login === "maxim" && r.role === "SERVICE_MANAGER")).toBe(true);
  expect(rows.some((r) => r.login === "artem" && r.role === "ADMIN")).toBe(true);
  // Сотрудник без входа заводится в «Команде» и в списке доступа не появляется.
  expect(rows.some((r) => r.role === "EMPLOYEE")).toBe(false);
});

test("пароль учётки офиса меняется и возвращается", async ({ browser }) => {
  test.slow();
  const actx = await browser.newContext();
  const admin = await actx.newPage();
  await login(admin, "artem");
  const maxim = (await accessList(admin)).find((r) => r.login === "maxim");
  expect(maxim).toBeTruthy();
  const temporary = `e2e-office-${Date.now()}`;

  const set = await admin.request.post("/api/admin/drivers/password", {
    data: { userId: maxim!.id, newPassword: temporary },
  });
  expect(set.status()).toBe(200);
  expect(JSON.stringify(await set.json())).not.toContain(temporary);

  try {
    const mctx = await browser.newContext();
    const maximPage = await mctx.newPage();
    await login(maximPage, "maxim", temporary);
    await expect(maximPage).toHaveURL(/\/machines/);
    await mctx.close();
  } finally {
    // Общая dev-БД: пароль обязан вернуться, даже если проверка выше упала.
    const restore = await admin.request.post("/api/admin/drivers/password", {
      data: { userId: maxim!.id, newPassword: PASSWORD },
    });
    expect(restore.status()).toBe(200);
  }
  await actx.close();
});

test("себе вход закрыть нельзя — система не запирается изнутри", async ({ page }) => {
  await login(page, "artem");
  const me = (await accessList(page)).find((r) => r.login === "artem");
  const res = await page.request.patch("/api/admin/drivers", {
    data: { userId: me!.id, canLogin: false },
  });
  expect([400, 409, 422]).toContain(res.status());
  // Вход остался.
  expect((await accessList(page)).find((r) => r.login === "artem")!.canLogin).toBe(true);
});

test("вход учётки офиса выключается и возвращается; EMPLOYEE — 404", async ({ page }) => {
  await login(page, "artem");
  const maxim = (await accessList(page)).find((r) => r.login === "maxim")!;

  const off = await page.request.patch("/api/admin/drivers", {
    data: { userId: maxim.id, canLogin: false },
  });
  try {
    expect(off.status()).toBe(200);
    expect(((await off.json()) as { data: { canLogin: boolean } }).data.canLogin).toBe(false);
  } finally {
    const back = await page.request.patch("/api/admin/drivers", {
      data: { userId: maxim.id, canLogin: true },
    });
    expect(back.status()).toBe(200);
  }

  // Сотрудник без входа: заводим через «Команду» и убеждаемся, что ручки доступа его не видят.
  const name = `e2e доступ ${Date.now()}`;
  const created = await page.request.post("/api/team", { data: { name } });
  expect(created.status()).toBe(201);
  const employeeId = ((await created.json()) as { data: { id: string } }).data.id;
  try {
    expect(
      (
        await page.request.post("/api/admin/drivers/password", {
          data: { userId: employeeId, newPassword: "vanmark2026" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await page.request.patch("/api/admin/drivers", { data: { userId: employeeId, canLogin: true } })).status(),
    ).toBe(404);
    // И водительские признаки ему тоже недоступны.
    expect(
      (await page.request.patch("/api/admin/drivers", { data: { userId: employeeId, isExternal: true } })).status(),
    ).toBe(404);
  } finally {
    expect((await page.request.delete(`/api/team/${employeeId}`)).status()).toBe(200);
  }
});

test("последнего администратора со входом не отключить", async ({ page }) => {
  await login(page, "artem");
  const admins = (await accessList(page)).filter((r) => r.role === "ADMIN" && r.canLogin);
  const other = admins.find((a) => a.login !== "artem");
  if (!other) {
    test.skip(true, "в этой базе один админ — сценарий проверяется юнит-тестом last-admin");
    return;
  }
  // Пока админов двое, второму вход выключить можно — и тогда третьего выключить уже нельзя.
  const off = await page.request.patch("/api/admin/drivers", {
    data: { userId: other.id, canLogin: false },
  });
  try {
    expect(off.status()).toBe(200);
    // Теперь «artem» — последний админ со входом; выключить его не даст ни себе, ни через LAST_ADMIN.
    const me = (await accessList(page)).find((r) => r.login === "artem")!;
    const self = await page.request.patch("/api/admin/drivers", {
      data: { userId: me.id, canLogin: false },
    });
    expect([400, 409, 422]).toContain(self.status());
  } finally {
    const back = await page.request.patch("/api/admin/drivers", {
      data: { userId: other.id, canLogin: true },
    });
    expect(back.status()).toBe(200);
  }
});

test("UI: две группы — «Офис» и «Водители», свой вход не переключается", async ({ page }) => {
  await login(page, "artem");
  await page.goto("/admin/drivers");
  await expect(page.getByRole("heading", { name: "Пользователи и доступ" })).toBeVisible();

  const office = page.getByTestId("access-office");
  await expect(office).toContainText("Милена");
  await expect(office).toContainText("Максим");

  const drivers = page.getByTestId("access-drivers");
  await expect(drivers).toContainText("Николай");

  // Своя строка: кнопки «Запретить» нет — сервер такой запрос всё равно отклонит.
  const self = page.locator("li").filter({ hasText: "это вы" }).first();
  await expect(self).toContainText("свой вход не меняют");
  await expect(self.getByTestId("user-login-toggle")).toHaveCount(0);
});
