import { test, expect, type Page } from "@playwright/test";
import {
  startServer,
  stopServer,
  startStallServer,
  stopStallServer,
  startErrorServer,
  stopErrorServer,
} from "./server";
import { resetActiveTasks } from "../reset";

// Устойчивость старта через РЕАЛЬНЫЙ service worker (инцидент «висит на логотипе», 31.07).
// Сплэш TWA снимается только по ответу на навигационный запрос, поэтому SW обязан ответить
// (из кэша) и на «висящей» сети, и в окно деплоя (5xx), и офлайн со start_url "/".
test.beforeAll(startServer);
test.afterAll(async () => {
  await stopStallServer();
  await stopErrorServer();
  await startServer();
});
test.beforeEach(resetActiveTasks);

const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Подготовка: вход, /m в кэше SW, страница под контролем SW. */
async function warmUp(page: Page): Promise<void> {
  await login(page, "pisarev");
  await page.goto("/m");
  await expect(page.getByText(/Смена|Открыть смену|Сегодня/).first()).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });
  await page.waitForFunction(
    async () => {
      for (const k of await caches.keys()) {
        if (await (await caches.open(k)).match("/m", { ignoreVary: true })) return true;
      }
      return false;
    },
    null,
    { timeout: 20_000 },
  );
}

test("«висящая» сеть: навигация отвечает из кэша за ~таймаут, а не ждёт вечно", async ({ page }) => {
  test.slow();
  await warmUp(page);

  // Порт жив, но молчит навсегда — как мобильная сеть с сигналом без данных.
  await stopServer();
  await startStallServer();

  const started = Date.now();
  await page.reload();
  await expect(page.getByText(/Смена|Открыть смену|Сегодня/).first()).toBeVisible({ timeout: 25_000 });
  // NAV_TIMEOUT_MS = 8с; до фикса ожидание было неограниченным (сплэш висел минуты).
  expect(Date.now() - started).toBeLessThan(20_000);

  await stopStallServer();
  await startServer();
});

test("холодный офлайн-старт со start_url \"/\": редирект на оболочку /m из кэша", async ({ page }) => {
  test.slow();
  await warmUp(page);

  await stopServer(); // полный офлайн

  // TWA стартует с "/" — корень всегда редирект и в кэше его нет. SW обязан отправить на /m.
  await page.goto("/");
  await expect(page.getByText(/Смена|Открыть смену|Сегодня/).first()).toBeVisible({ timeout: 25_000 });
  expect(new URL(page.url()).pathname).toBe("/m");
  // И это не подсунутый под "/" HTML — настоящая навигация на /m (иначе рассинхрон гидратации).
  await expect(page.getByRole("textbox", { name: /логин/i })).toHaveCount(0);

  await startServer();
});

test("окно деплоя: на 5xx от прокси навигация отдаёт кэш, а не голую ошибку", async ({ page }) => {
  test.slow();
  await warmUp(page);

  await stopServer();
  await startErrorServer(); // как Caddy во время перезапуска бэкенда: 503 на всё

  await page.goto("/m");
  await expect(page.getByText(/Смена|Открыть смену|Сегодня/).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Service Unavailable")).toHaveCount(0);

  await stopErrorServer();
  await startServer();
});

test("build-skew: чанк прошлой сборки отдаётся из предыдущего app-кэша (инвариант деплоя)", async ({ page }) => {
  test.slow();
  await warmUp(page);

  // Кладём «чанк прошлой сборки» в отдельный старый app-кэш — как он остаётся после деплоя.
  await page.evaluate(async () => {
    const c = await caches.open("vanmark-app-oldbuild-test");
    await c.put(
      "/_next/static/chunks/fake-old-build-chunk.js",
      new Response("window.__oldChunk=1", { headers: { "Content-Type": "application/javascript" } }),
    );
  });

  // Старый клиент запрашивает свой хэш-чанк: SW обязан отдать его из предыдущего кэша (не 404).
  const body = await page.evaluate(async () => {
    const res = await fetch("/_next/static/chunks/fake-old-build-chunk.js");
    return { ok: res.ok, text: await res.text() };
  });
  expect(body.ok).toBe(true);
  expect(body.text).toBe("window.__oldChunk=1");

  await page.evaluate(() => caches.delete("vanmark-app-oldbuild-test"));
});

test("самолечение IndexedDB: БД, созданная без сторов (старый SW-sync), доращивается сама", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // «Отравляем» БД до входа: versionless-открытие без создания сторов — как старый public/sw.js
  // при sync-событии раньше первого запуска приложения.
  await page.goto("/login");
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase("vanmark-offline");
      del.onsuccess = del.onerror = del.onblocked = () => resolve();
    });
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("vanmark-offline"); // без версии и БЕЗ создания сторов
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });

  // Обычная работа приложения должна вылечить БД (openWithRepair доращивает сторы версией+1).
  await login(page, "pisarev");
  await page.goto("/m");
  await page.waitForFunction(
    async () => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open("vanmark-offline");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });
      if (!db) return false;
      const ok = ["responses", "queue", "blobs"].every((s) => db.objectStoreNames.contains(s));
      db.close();
      return ok;
    },
    null,
    { timeout: 20_000 },
  );

  await ctx.close();
});
