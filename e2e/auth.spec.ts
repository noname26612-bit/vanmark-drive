import { test, expect, type Page } from "@playwright/test";

// Пароль сид-пользователей (тот же, что в .env при сиде). Локальный дефолт — vanmark123.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function submitLogin(page: Page, login: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

test.describe("вход по ролям → свой экран", () => {
  const cases = [
    { login: "artem", path: "/admin", label: "Администратор" },
    { login: "milena", path: "/board", label: "Диспетчер" },
    { login: "kashirskiy", path: "/m", label: "Водитель" },
    { login: "pisarev", path: "/m", label: "Водитель" },
  ];

  for (const { login, path, label } of cases) {
    test(`${login} → ${path}`, async ({ page }) => {
      await submitLogin(page, login, PASSWORD);
      await page.waitForURL(`**${path}`);
      expect(new URL(page.url()).pathname).toBe(path);
      // в шапке видно роль (значит guard пустил и сессия с ролью работает)
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    });
  }
});

test("неверный пароль — ошибка, остаёмся на /login", async ({ page }) => {
  await submitLogin(page, "milena", "definitely-wrong");
  await expect(page.locator('p[role="alert"]')).toContainText("Неверный логин или пароль");
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("canLogin=false не пускает; админ включает/выключает вход («Водители — доступ», 02.07)", async ({
  browser,
  page,
}) => {
  // Вход внешнего перевозчика теперь управляется админом (02.07) — общая dev-БД могла оставить его
  // включённым после других спеков. Тест сам выключает, проверяет отказ, затем включает обратно.
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await submitLogin(artem, "artem", PASSWORD);
  await artem.waitForURL((url) => !url.pathname.startsWith("/login"));
  const list = (await (await artem.request.get("/api/admin/drivers")).json()).data as {
    id: string;
    isExternal: boolean;
  }[];
  const carrier = list.find((d) => d.isExternal);
  expect(carrier).toBeTruthy();
  const off = await artem.request.patch("/api/admin/drivers", {
    data: { driverId: carrier!.id, canLogin: false },
  });
  expect(off.status()).toBe(200);

  // Пока вход выключен — та же ошибка, что при неверном пароле (не раскрываем причину).
  await submitLogin(page, "sultan", PASSWORD);
  await expect(page.locator('p[role="alert"]')).toContainText("Неверный логин или пароль");
  expect(new URL(page.url()).pathname).toBe("/login");

  // Возвращаем вход (рабочее состояние 02.07: перевозчик пользуется приложением).
  const on = await artem.request.patch("/api/admin/drivers", {
    data: { driverId: carrier!.id, canLogin: true },
  });
  expect(on.status()).toBe(200);
  await actx.close();
});

test("брутфорс: 10 неверных попыток → блокировка", async ({ page }) => {
  test.slow(); // 11 последовательных сабмитов
  const victim = "e2e-bruteforce-victim"; // отдельный ключ, не задевает реальных пользователей

  for (let i = 0; i < 10; i++) {
    await submitLogin(page, victim, `wrong-${i}`);
    await expect(page.locator('p[role="alert"]')).toBeVisible();
  }

  // следующая попытка отбивается блокировкой, а не «неверным паролем»
  await submitLogin(page, victim, "wrong-final");
  await expect(page.locator('p[role="alert"]')).toContainText("Слишком много попыток");
});

test("гость на защищённом маршруте → редирект на /login", async ({ page }) => {
  await page.goto("/board");
  await page.waitForURL("**/login");
  expect(new URL(page.url()).pathname).toBe("/login");
});
