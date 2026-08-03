// Админка «Водители — доступ» (03.08): признак «внешний перевозчик» и смена пароля.
// Раньше и то, и другое менялось только сидом или запросом к базе.
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

async function driverByLogin(page: Page, driverLogin: string): Promise<{ id: string; isExternal: boolean }> {
  const res = await page.request.get("/api/admin/drivers");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: { id: string; login: string; isExternal: boolean }[] };
  const found = body.data.find((d) => d.login === driverLogin);
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

test("нельзя менять не водителя и нельзя два действия сразу", async ({ page }) => {
  await login(page, "artem");
  const driver = await driverByLogin(page, "nikolay");

  // Пароль диспетчера/админа через эту ручку не меняется — иначе это захват учётки.
  // id чужой роли узнать неоткуда, поэтому проверяем на заведомо несуществующем и на двойном действии.
  const foreign = await page.request.post("/api/admin/drivers/password", {
    data: { driverId: "00000000-0000-0000-0000-000000000000", newPassword: "vanmark2026" },
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
