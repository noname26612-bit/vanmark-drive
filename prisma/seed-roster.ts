// Безопасный ростер-сид для прода. В отличие от prisma/seed.ts НЕ перетирает пароли существующих
// пользователей (см. память проекта: полный db:seed на бою опасен — сбрасывает пароли по SEED_PASSWORD).
// Делает ровно две вещи идемпотентно:
//   1) переименовывает внешнего перевозчика (login=sultan) в нейтральное «Внешний перевозчик»;
//   2) заводит штатного подменного водителя Николая (login=nikolay), если его ещё нет.
// Пароль Николаю ставится ТОЛЬКО при создании, из SEED_PASSWORD_NIKOLAY (приоритетно) или SEED_PASSWORD.
// Повторный запуск пароль не меняет. Запуск: `pnpm db:seed:roster`.
import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@/lib/password";

const EXTERNAL = { login: "sultan", name: "Внешний перевозчик" };
const NIKOLAY = { login: "nikolay", name: "Николай" };

export async function seedRoster(prisma: PrismaClient): Promise<void> {
  // 1) Переименование внешнего перевозчика (только имя; логин/canLogin/пароль не трогаем).
  const renamed = await prisma.user.updateMany({
    where: { login: EXTERNAL.login },
    data: { name: EXTERNAL.name },
  });
  console.log(
    renamed.count > 0
      ? `  ✓ внешний перевозчик переименован в «${EXTERNAL.name}»`
      : `  ⚠ пользователь ${EXTERNAL.login} не найден — переименование пропущено`,
  );

  // 2) Николай: создаём только если отсутствует. Существующего не трогаем (пароль/прочее сохраняем).
  const existing = await prisma.user.findUnique({ where: { login: NIKOLAY.login }, select: { id: true } });
  if (existing) {
    console.log(`  ✓ ${NIKOLAY.login} уже существует — пропуск (пароль не меняем)`);
    return;
  }
  const password = process.env.SEED_PASSWORD_NIKOLAY || process.env.SEED_PASSWORD;
  if (!password) {
    throw new Error("Для создания Николая задай SEED_PASSWORD_NIKOLAY (или общий SEED_PASSWORD) в .env");
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { login: NIKOLAY.login, name: NIKOLAY.name, role: "DRIVER", canLogin: true, passwordHash },
  });
  console.log(`  ✓ создан ${NIKOLAY.login} — ${NIKOLAY.name} (DRIVER, со входом)`);
}

// Standalone-запуск (`pnpm db:seed:roster`) — для прода после деплоя кода.
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL не задан — проверь .env");
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    await seedRoster(prisma);
    console.log("Ростер-сид готов.");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].includes("seed-roster")) {
  main().catch((error) => {
    console.error("Ростер-сид упал:", error);
    process.exit(1);
  });
}
