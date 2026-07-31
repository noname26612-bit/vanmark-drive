import { test, expect, type Page } from "@playwright/test";

// Наблюдаемость (31.07): клиентские ошибки уезжают на сервер (POST /api/client-log) — инциденты
// разбираются по docker logs, без телефона водителя.

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("необработанная ошибка на странице уезжает в /api/client-log", async ({ page }) => {
  await login(page, "pisarev");
  await page.goto("/m");

  const reportReq = page.waitForRequest(
    (r) => r.url().includes("/api/client-log") && r.method() === "POST",
    { timeout: 15_000 },
  );
  // Искусственная необработанная ошибка — как падение гидратации/чанка в бою.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e-client-log-probe");
    }, 0);
  });
  const req = await reportReq;
  const body = req.postDataJSON() as { msg?: string; context?: string };
  expect(body.msg).toContain("e2e-client-log-probe");
  expect(body.context).toBe("window.onerror");
});

test("эндпоинт терпим к мусору: без сессии, битый JSON, оверсайз — всегда 204", async ({ request }) => {
  // Аноним с нормальным телом (ошибка до входа — легитимный кейс).
  const anon = await request.post("/api/client-log", { data: { msg: "до входа" } });
  expect(anon.status()).toBe(204);

  // Битый JSON не роняет обработчик.
  const broken = await request.post("/api/client-log", {
    headers: { "Content-Type": "application/json" },
    data: "{это не json",
  });
  expect(broken.status()).toBe(204);

  // Оверсайз (>8 КБ) дропается без чтения.
  const big = await request.post("/api/client-log", { data: { msg: "x".repeat(20_000) } });
  expect(big.status()).toBe(204);

  // Совсем без msg — тоже тихо.
  const empty = await request.post("/api/client-log", { data: { context: "no-msg" } });
  expect(empty.status()).toBe(204);
});
