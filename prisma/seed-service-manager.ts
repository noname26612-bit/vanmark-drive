// Точечный сид менеджера-сервисника (Максим, PRD §16). Заводит РОВНО ОДНОГО пользователя с ролью
// SERVICE_MANAGER и больше ничего не трогает.
//
// Почему отдельный скрипт, а не общий `pnpm db:seed`: полный сид перетирает пароли всей команды по
// SEED_PASSWORD — на проде это инцидент (урок этапов 11–15, зафиксирован в памяти проекта).
// Здесь: существующего пользователя НЕ трогаем вовсе (пароль сохраняем), новому пароль ставим из
// SEED_PASSWORD_MAXIM, иначе из общего SEED_PASSWORD. Повторный запуск идемпотентен.
//
// Запуск: `pnpm db:seed:service-manager`
// Логин/имя можно переопределить через SM_LOGIN / SM_NAME (по умолчанию maxim / Максим).
import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@/lib/password";

const DEFAULT_LOGIN = "maxim";
const DEFAULT_NAME = "Максим";
const POSITION = "Менеджер-сервисник";

export async function seedServiceManager(prisma: PrismaClient): Promise<void> {
  const login = (process.env.SM_LOGIN || DEFAULT_LOGIN).trim().toLowerCase();
  const name = (process.env.SM_NAME || DEFAULT_NAME).trim();

  const existing = await prisma.user.findUnique({
    where: { login },
    select: { id: true, role: true, name: true },
  });

  if (existing) {
    // Пароль и имя существующего не трогаем. Роль поправим, только если она ещё не та — это
    // штатный случай «сотрудник уже был заведён под другой ролью и переходит на новую должность».
    if (existing.role !== "SERVICE_MANAGER") {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "SERVICE_MANAGER", position: POSITION, isActive: true, canLogin: true },
      });
      console.log(`  ✓ ${login}: роль изменена ${existing.role} → SERVICE_MANAGER (пароль не менялся)`);
      return;
    }
    console.log(`  ✓ ${login} уже менеджер-сервисник — пропуск (пароль не меняем)`);
    return;
  }

  const password = process.env.SEED_PASSWORD_MAXIM || process.env.SEED_PASSWORD;
  if (!password) {
    throw new Error(
      `Для создания ${login} задай SEED_PASSWORD_MAXIM (или общий SEED_PASSWORD) в .env`,
    );
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      login,
      name,
      role: "SERVICE_MANAGER",
      position: POSITION,
      isActive: true,
      canLogin: true,
      passwordHash,
    },
  });
  console.log(`  ✓ создан ${login} — ${name} (SERVICE_MANAGER, «${POSITION}»)`);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL не задан — проверь .env");
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    await seedServiceManager(prisma);
    console.log("Сид менеджера-сервисника готов.");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].includes("seed-service-manager")) {
  main().catch((error) => {
    console.error("Сид менеджера-сервисника упал:", error);
    process.exit(1);
  });
}
