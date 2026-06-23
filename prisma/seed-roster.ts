// Безопасный ростер-сид для прода. В отличие от prisma/seed.ts НЕ перетирает пароли существующих
// пользователей (см. память проекта: полный db:seed на бою опасен — сбрасывает пароли по SEED_PASSWORD).
// Делает идемпотентно:
//   1) переименовывает внешнего перевозчика (login=sultan) в нейтральное «Внешний перевозчик»;
//   2) заводит штатного подменного водителя Николая (login=nikolay), если его ещё нет;
//   3) заводит ген. директора Михаила (login=mikhail, права ADMIN, должность «Директор»), если его ещё нет.
// Пароль новым пользователям ставится ТОЛЬКО при создании, из SEED_PASSWORD_<LOGIN> (приоритетно)
// или SEED_PASSWORD. Повторный запуск пароль не меняет. Запуск: `pnpm db:seed:roster`.
import "dotenv/config";
import { PrismaClient, type Role } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@/lib/password";

const EXTERNAL = { login: "sultan", name: "Внешний перевозчик" };
const NIKOLAY = { login: "nikolay", name: "Николай" };
const MIKHAIL = { login: "mikhail", name: "Михаил", position: "Директор" };

/**
 * Создаёт пользователя, ТОЛЬКО если его ещё нет. Существующего не трогает (пароль/прочее сохраняем —
 * правило безопасного прод-сида). Пароль при создании берёт из passwordEnvKey, иначе из общего
 * SEED_PASSWORD. Возвращает без действия, если логин уже занят.
 */
async function ensureUser(
  prisma: PrismaClient,
  cfg: { login: string; name: string; role: Role; position?: string | null; passwordEnvKey: string },
): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { login: cfg.login }, select: { id: true } });
  if (existing) {
    console.log(`  ✓ ${cfg.login} уже существует — пропуск (пароль не меняем)`);
    return;
  }
  const password = process.env[cfg.passwordEnvKey] || process.env.SEED_PASSWORD;
  if (!password) {
    throw new Error(`Для создания ${cfg.login} задай ${cfg.passwordEnvKey} (или общий SEED_PASSWORD) в .env`);
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      login: cfg.login,
      name: cfg.name,
      role: cfg.role,
      canLogin: true,
      position: cfg.position ?? null,
      passwordHash,
    },
  });
  console.log(`  ✓ создан ${cfg.login} — ${cfg.name} (${cfg.role}${cfg.position ? `, «${cfg.position}»` : ""})`);
}

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

  // 2) Николай — штатный подменный водитель (входит сам, выполняет любые задачи).
  await ensureUser(prisma, {
    login: NIKOLAY.login,
    name: NIKOLAY.name,
    role: "DRIVER",
    passwordEnvKey: "SEED_PASSWORD_NIKOLAY",
  });

  // 3) Михаил — ген. директор: полные права ADMIN (как у Артёма), в шапке подпись «Директор».
  await ensureUser(prisma, {
    login: MIKHAIL.login,
    name: MIKHAIL.name,
    role: "ADMIN",
    position: MIKHAIL.position,
    passwordEnvKey: "SEED_PASSWORD_MIKHAIL",
  });
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
