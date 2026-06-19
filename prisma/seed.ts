// Сид пользователей (этап 1). Идемпотентный: upsert по login, повторный запуск не плодит дубли.
// Пароль берём из SEED_PASSWORD (см. .env.example) — в коде паролей нет (CLAUDE.md правило 5).
// Запуск: `pnpm db:seed` (нужен поднятый Postgres и применённые миграции).
import "dotenv/config";
import { PrismaClient, type Role } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@/lib/password";
import { seedKpi } from "./seed-kpi";
import { seedCapacity } from "./seed-capacity";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL не задан — проверь .env");
}

const seedPassword = process.env.SEED_PASSWORD;
if (!seedPassword) {
  throw new Error("SEED_PASSWORD не задан — задай в .env (см. .env.example).");
}

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

type SeedUser = {
  login: string; // только латиница, в нижнем регистре (вход нормализует к lower-case)
  name: string;
  role: Role;
  canLogin?: boolean; // по умолчанию true
};

// Команда из ROADMAP этап 1 + внешний перевозчик из PRD §2 (без права входа).
const USERS: SeedUser[] = [
  { login: "artem", name: "Артём", role: "ADMIN" },
  { login: "milena", name: "Милена", role: "DISPATCHER" },
  { login: "kashirskiy", name: "Алексей Каширский", role: "DRIVER" },
  { login: "pisarev", name: "Алексей Писарев", role: "DRIVER" },
  // Султан — наёмный перевозчик: задачи на него ведёт диспетчер, сам не входит.
  { login: "sultan", name: "Султан (внешний перевозчик)", role: "DRIVER", canLogin: false },
];

// Типы задач (PRD §3, новый список — решение Артёма 18.06.2026). Порядок = sortOrder = очередь
// в списке у водителя/диспетчера. requiresSignedDoc — нужен ли подписанный акт по умолчанию
// (5 типов с актом). Это НЕ гейт завершения и не блокировка — отсутствие требуемого акта = отметка
// KPI UNSIGNED_DOCS + недобор для бонуса за комплектность (PRD §12.6). Диспетчер может снять
// требование на конкретной заявке (Task.requiresSignedDoc + actWaivedNote). Фото — везде по желанию
// (поле TaskType.requiresPhoto больше не используется как гейт). Иконки — имена lucide (TypeIcon).
// requiresPricing — нужна ли ведомость работ + расценка (этап 12, PRD §13): выездной ремонт, гарантия.
const TASK_TYPES: { name: string; icon: string; requiresSignedDoc: boolean; requiresPricing: boolean }[] = [
  // С актом: акт выполненных работ / приёма-передачи / возврата (PRD §13).
  { name: "Выездной ремонт / диагностика", icon: "wrench", requiresSignedDoc: true, requiresPricing: true },
  { name: "Забор в ремонт", icon: "package-minus", requiresSignedDoc: true, requiresPricing: false },
  { name: "Гарантийный ремонт", icon: "shield-check", requiresSignedDoc: true, requiresPricing: true },
  { name: "Доставка в аренду", icon: "truck", requiresSignedDoc: true, requiresPricing: false },
  { name: "Забор с аренды", icon: "undo-2", requiresSignedDoc: true, requiresPricing: false },
  // Без акта.
  { name: "Доставка из ремонта", icon: "package-check", requiresSignedDoc: false, requiresPricing: false },
  { name: "Доставка проданного оборудования", icon: "package-plus", requiresSignedDoc: false, requiresPricing: false },
  { name: "Сдача в ТК", icon: "warehouse", requiresSignedDoc: false, requiresPricing: false },
  { name: "Забрать посылку", icon: "package", requiresSignedDoc: false, requiresPricing: false },
  { name: "Закупка/выкуп станка", icon: "shopping-cart", requiresSignedDoc: false, requiresPricing: false },
  { name: "Прочее", icon: "ellipsis", requiresSignedDoc: false, requiresPricing: false },
];

// Разделы справочника (группы услуг/товаров). Артём правит/добавляет в /admin/work-catalog.
const WORK_CATEGORIES: { name: string; sortOrder: number }[] = [
  { name: "Услуги", sortOrder: 1 },
  { name: "Запчасти / товары", sortOrder: 2 },
];

// Справочник работ для ведомости (PRD §13.3). Стартовый набор VanMark (решение Артёма 19.06):
// реальные названия/цены Артём правит в /admin/work-catalog. price — цена-подсказка ₽/ед, category —
// название раздела. Сид — первичный загрузчик: create ставит цену/раздел, update их НЕ перетирает
// (источник правды — админка). Позиции не из списка деактивируются (прежний черновик уходит).
const WORK_CATALOG: { name: string; price?: number; category?: string }[] = [
  { name: "Выездная диагностика / ремонт", price: 20_000, category: "Услуги" },
];

// KPI / зарплата (Фаза 1.5): дефолты и логика — в prisma/seed-kpi.ts (там же безопасный
// прод-сид `pnpm db:seed:kpi`, не трогающий пользователей). Здесь только вызываем seedKpi().

// Пароль учётки: индивидуальный SEED_PASSWORD_<LOGIN> (если задан) приоритетнее общего SEED_PASSWORD.
// На локалке достаточно общего; на проде Артём может задать каждому свой (см. deploy/.env.prod.example).
function passwordFor(login: string, fallback: string): string {
  return process.env[`SEED_PASSWORD_${login.toUpperCase()}`] || fallback;
}

async function main(defaultPassword: string): Promise<void> {
  for (const u of USERS) {
    const canLogin = u.canLogin ?? true;
    const passwordHash = await hashPassword(passwordFor(u.login, defaultPassword));
    await prisma.user.upsert({
      where: { login: u.login },
      update: { name: u.name, role: u.role, canLogin, isActive: true, passwordHash },
      create: { login: u.login, name: u.name, role: u.role, canLogin, passwordHash },
    });
    console.log(`  ✓ ${u.login} — ${u.name} (${u.role}${canLogin ? "" : ", без входа"})`);
  }

  for (const [i, t] of TASK_TYPES.entries()) {
    await prisma.taskType.upsert({
      where: { name: t.name },
      update: {
        icon: t.icon,
        requiresSignedDoc: t.requiresSignedDoc,
        requiresPricing: t.requiresPricing,
        sortOrder: i + 1,
        isActive: true,
      },
      create: {
        name: t.name,
        icon: t.icon,
        requiresSignedDoc: t.requiresSignedDoc,
        requiresPricing: t.requiresPricing,
        sortOrder: i + 1,
      },
    });
  }
  console.log(`  ✓ типы задач: ${TASK_TYPES.length}`);

  // Разделы справочника (upsert по имени; update не перетирает админские правки сверх порядка/активности).
  for (const c of WORK_CATEGORIES) {
    await prisma.workCategory.upsert({
      where: { name: c.name },
      update: { sortOrder: c.sortOrder, isActive: true },
      create: { name: c.name, sortOrder: c.sortOrder },
    });
  }
  const cats = await prisma.workCategory.findMany();
  const catId = (name?: string): string | null => (name ? (cats.find((c) => c.name === name)?.id ?? null) : null);
  console.log(`  ✓ разделы справочника: ${WORK_CATEGORIES.length}`);

  for (const [i, item] of WORK_CATALOG.entries()) {
    await prisma.workCatalogItem.upsert({
      where: { name: item.name },
      // update НЕ трогает defaultPrice/categoryId — их настраивает админ в UI (PRD §13.3).
      update: { sortOrder: i + 1, isActive: true },
      create: { name: item.name, sortOrder: i + 1, defaultPrice: item.price ?? null, categoryId: catId(item.category) },
    });
  }
  // Деактивируем работы, которых нет в актуальном списке (прежний черновик) — НЕ удаляем,
  // чтобы не порвать ссылки уже заполненных ведомостей (WorkItem.catalogItemId).
  const catalogNames = WORK_CATALOG.map((w) => w.name);
  const deactivated = await prisma.workCatalogItem.updateMany({
    where: { name: { notIn: catalogNames }, isActive: true },
    data: { isActive: false },
  });
  console.log(`  ✓ справочник работ: ${WORK_CATALOG.length} активных, деактивировано прежних: ${deactivated.count}`);

  await seedKpi(prisma);
  await seedCapacity(prisma);
}

main(seedPassword)
  .then(() => console.log("Сид пользователей готов."))
  .catch((error) => {
    console.error("Сид упал:", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
