import { test, expect, type Page } from "@playwright/test";

// Справочник работ: цена-подсказка (defaultPrice) редактируется админом; ВОДИТЕЛЬ цен не видит
// (PRD §13 — водитель не формирует и не видит цены до расценки). Только админ создаёт/правит.

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("водитель не видит цену в справочнике; админ задаёт цену-подсказку; чужие не правят", async ({
  browser,
}) => {
  test.slow();
  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await login(driver, "kashirskiy");

  // справочник водителя: позиции есть, поля цены НЕТ
  const cat = await (await driver.request.get("/api/work-catalog")).json();
  expect(cat.data.length).toBeGreaterThan(0);
  for (const it of cat.data) {
    expect(it.name).toBeTruthy();
    expect("defaultPrice" in it).toBe(false); // цена водителю не отдаётся
  }

  // админ заводит работу с ценой-подсказкой
  const actx = await browser.newContext();
  const artem = await actx.newPage();
  await login(artem, "artem");
  const name = `e2e работа ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const created = await artem.request.post("/api/admin/work-catalog", { data: { name, defaultPrice: 1234 } });
  expect(created.status()).toBe(201);

  // в админском справочнике цена видна
  const all = await (await artem.request.get("/api/admin/work-catalog")).json();
  const row = all.data.find((w: { name: string }) => w.name === name);
  expect(row.defaultPrice).toBe(1234);

  // правка цены работает
  const patched = await artem.request.patch(`/api/admin/work-catalog/${row.id}`, { data: { defaultPrice: 1500 } });
  expect(patched.status()).toBe(200);
  expect((await patched.json()).data.defaultPrice).toBe(1500);

  // водитель по-прежнему не видит цену даже для этой работы
  const cat2 = await (await driver.request.get("/api/work-catalog")).json();
  const drow = cat2.data.find((w: { name: string }) => w.name === name);
  expect(drow).toBeTruthy();
  expect("defaultPrice" in drow).toBe(false);

  // изоляция: не-админ не создаёт и не правит справочник
  const mctx = await browser.newContext();
  const milena = await mctx.newPage();
  await login(milena, "milena");
  expect((await milena.request.post("/api/admin/work-catalog", { data: { name: "взлом" } })).status()).toBe(403);
  expect((await driver.request.patch(`/api/admin/work-catalog/${row.id}`, { data: { defaultPrice: 0 } })).status()).toBe(403);

  await dctx.close();
  await actx.close();
  await mctx.close();
});
