import { test, expect, type Page } from "@playwright/test";
import { taskTypeIdByName, userIdByLogin } from "./reset";

// Копирование задачи (22.08.2026, решение Артёма): работа повторяется — тот же клиент, тот же
// адрес, — а меняются день и исполнитель. Копия НЕ наследует дату (ставит сегодня), исполнителя,
// напарника и статус; всё остальное переносится.
//
// Тесты делят общую dev-БД: каждая заявка помечается уникальным заголовком и ищется по нему.
const PASSWORD = process.env.SEED_PASSWORD ?? "vanmark123";

async function login(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** Сегодняшний московский день так, как его печатает поле даты («дд.мм.гггг»). */
function todayLabel(): string {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

async function createTask(
  page: Page,
  data: Record<string, unknown>,
): Promise<{ id: string; number: number; staffNumber: number | null }> {
  const res = await page.request.post("/api/tasks", { data });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

test("копия заявки с карточки: поля перенесены, дата сегодня, исполнитель пуст", async ({ page }) => {
  test.slow();
  await login(page, "milena");
  const typeId = await taskTypeIdByName("Доставка проданного об.");
  const driverId = await userIdByLogin("kashirskiy");

  const title = unique("Копия-источник");
  const source = await createTask(page, {
    typeId,
    title,
    address: "Москва, ул. Копий, 1",
    orgName: "ООО Копия",
    contactPhone: "+70000000001",
    invoiceNumber: "СЧ-КОПИЯ",
    assigneeId: driverId,
    scheduledDate: "2026-07-01",
    priority: true,
    passStatus: "NEEDED",
  });

  await page.goto(`/tasks/${source.id}`);
  await page.getByTestId("task-copy").click();

  // Заголовок называет источник, янтарная подсказка просит проверить то, что копия не наследует.
  const dialog = page.getByRole("dialog", { name: `Копия заявки №${source.number}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("copy-hint")).toContainText(`№${source.number}`);

  // Суть, клиент и счёт перенеслись; дата — сегодня; исполнителя нет (в форме создания его выбирают).
  await expect(dialog.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм")).toHaveValue(title);
  await expect(dialog.getByPlaceholder("Москва, ул. ..., д. ...")).toHaveValue("Москва, ул. Копий, 1");
  await expect(dialog.getByTestId("create-org")).toHaveValue("ООО Копия");
  await expect(dialog.getByTestId("create-invoice")).toHaveValue("СЧ-КОПИЯ");
  await expect(dialog.getByTestId("create-date")).toHaveValue(todayLabel());
  await expect(dialog.getByTestId("create-assignee")).toHaveValue("");

  // Создаём копию — попадаем на её карточку, номер другой, исходная заявка не тронута.
  const copyTitle = `${title} (копия)`;
  await dialog.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм").fill(copyTitle);
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();

  await page.waitForURL(
    (url) => /\/tasks\/[0-9a-f-]+$/.test(url.pathname) && !url.pathname.endsWith(source.id),
  );
  await expect(page.getByText(copyTitle).first()).toBeVisible();
  await expect(page.getByText(`№${source.number} ·`)).toHaveCount(0);

  // Исполнителя копия не унаследовала — назначает диспетчер.
  await expect(page.getByTestId("card-assignee")).toHaveValue("");
});

test("копия из строки «Все задачи» открывает форму копии", async ({ page }) => {
  await login(page, "milena");
  const typeId = await taskTypeIdByName("Доставка проданного об.");

  const title = unique("Копия-из-списка");
  const source = await createTask(page, { typeId, title, address: "Москва, ул. Списка, 2" });

  await page.goto("/tasks");
  await page.getByTestId("task-search").fill(title);
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await row.getByTestId("task-copy").click();

  const dialog = page.getByRole("dialog", { name: `Копия заявки №${source.number}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("ЛБМ 200 + нож, 0,7 мм")).toHaveValue(title);
  await expect(dialog.getByTestId("create-date")).toHaveValue(todayLabel());

  // Форма копии — обычное создание: «Отмена» переспрашивает и закрывает без черновика.
  page.once("dialog", (d) => void d.accept());
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("копия задачи цеха: своя форма, номер Ц-N в заголовке", async ({ page }) => {
  await login(page, "milena");
  const performers = (await (await page.request.get("/api/staff-performers")).json()).data as {
    id: string;
    name: string;
  }[];
  expect(performers.length).toBeGreaterThan(0);

  const title = unique("Копия-цеха");
  const source = await createTask(page, {
    kind: "STAFF",
    title,
    description: "Собрать ролики — тест копии",
    assigneeId: performers[0].id,
    priority: true,
  });

  await page.goto(`/tasks/${source.id}`);
  await page.getByTestId("task-copy").click();

  const dialog = page.getByRole("dialog", { name: `Копия задачи Ц-${source.staffNumber}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("staff-title")).toHaveValue(title);
  await expect(dialog.getByTestId("staff-description")).toHaveValue("Собрать ролики — тест копии");
  await expect(dialog.getByTestId("staff-date")).toHaveValue(todayLabel());
  await expect(dialog.getByTestId("staff-assignee")).toHaveValue(""); // исполнителя копия не наследует

  const copyTitle = `${title} (копия)`;
  await dialog.getByTestId("staff-title").fill(copyTitle);
  await dialog.getByTestId("staff-save").click();

  await page.waitForURL(
    (url) => /\/tasks\/[0-9a-f-]+$/.test(url.pathname) && !url.pathname.endsWith(source.id),
  );
  await expect(page.getByText(copyTitle).first()).toBeVisible();
});

test("в сегменте «Цех» кнопка «Задача» открывает форму цеха, а не доставки", async ({ page }) => {
  await login(page, "milena");
  await page.goto("/tasks");
  await page.getByTestId("tasks-kind-STAFF").click();
  await page.getByRole("button", { name: "Задача" }).click();

  const dialog = page.getByRole("dialog", { name: "Задача сотруднику" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("staff-title")).toBeVisible();
  // Полей доставки (тип, адрес) у задачи цеха нет.
  await expect(dialog.getByTestId("create-type")).toHaveCount(0);
});
