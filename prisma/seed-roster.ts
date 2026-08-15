// Безопасный ростер-сид для прода. В отличие от prisma/seed.ts НЕ перетирает пароли существующих
// пользователей (см. память проекта: полный db:seed на бою опасен — сбрасывает пароли по SEED_PASSWORD).
// Делает идемпотентно:
//   1) переименовывает внешнего перевозчика (login=sultan) в нейтральное «Внешний перевозчик»;
//   2) заводит штатного подменного водителя Николая (login=nikolay), если его ещё нет;
//   3) заводит ген. директора Михаила (login=mikhail, права ADMIN, должность «Директор»), если его ещё нет;
//   4) заводит второго подменного водителя Александра (login=alexandr), если его ещё нет;
//   5) выдаёт Николаю доступ к разделам оборудования (15.08.2026) — существующему пользователю.
// Пароль новым пользователям ставится ТОЛЬКО при создании, из SEED_PASSWORD_<LOGIN> (приоритетно)
// или SEED_PASSWORD. Повторный запуск пароль не меняет. Запуск: `pnpm db:seed:roster`.
import "dotenv/config";
import { PrismaClient, type Role } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@/lib/password";

const EXTERNAL = { login: "sultan", name: "Внешний перевозчик" };
const NIKOLAY = { login: "nikolay", name: "Николай" };
const ALEXANDR = { login: "alexandr", name: "Александр" };
const MIKHAIL = { login: "mikhail", name: "Михаил", position: "Директор" };

/**
 * Создаёт пользователя, ТОЛЬКО если его ещё нет. Существующего не трогает (пароль/прочее сохраняем —
 * правило безопасного прод-сида). Пароль при создании берёт из passwordEnvKey, иначе из общего
 * SEED_PASSWORD. Возвращает без действия, если логин уже занят.
 */
async function ensureUser(
  prisma: PrismaClient,
  cfg: {
    login: string;
    name: string;
    role: Role;
    position?: string | null;
    passwordEnvKey: string;
    equipmentAccess?: boolean;
  },
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
      equipmentAccess: cfg.equipmentAccess ?? false,
      passwordHash,
    },
  });
  console.log(`  ✓ создан ${cfg.login} — ${cfg.name} (${cfg.role}${cfg.position ? `, «${cfg.position}»` : ""})`);
}

export async function seedRoster(prisma: PrismaClient): Promise<void> {
  // 1) Переименование внешнего перевозчика + признак isExternal (02.07: без смен, стоимость поездки
  // в заявке). Логин/canLogin/пароль не трогаем — вход включает админ в «Водители — доступ».
  const renamed = await prisma.user.updateMany({
    where: { login: EXTERNAL.login },
    data: { name: EXTERNAL.name, isExternal: true },
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

  // 4) Александр — второй подменный водитель (15.08.2026, полная копия Николая): входит сам,
  // выполняет любые задачи, в KPI не попадает (денежного профиля нет). Доступ к разделам
  // оборудования выдаётся сразу при создании — за этим его и заводили.
  await ensureUser(prisma, {
    login: ALEXANDR.login,
    name: ALEXANDR.name,
    role: "DRIVER",
    passwordEnvKey: "SEED_PASSWORD_ALEXANDR",
    equipmentAccess: true,
  });

  // 5) Доступ к оборудованию Николаю (15.08.2026). Отдельным шагом, а не только при создании:
  // Николай на проде давно заведён, и права ему нужно выдать существующему. Пароль не трогаем.
  const equipped = await prisma.user.updateMany({
    where: { login: NIKOLAY.login, equipmentAccess: false },
    data: { equipmentAccess: true },
  });
  console.log(
    equipped.count > 0
      ? `  ✓ ${NIKOLAY.login}: выдан доступ к разделам оборудования`
      : `  ✓ ${NIKOLAY.login}: доступ к оборудованию уже есть (или пользователь не найден)`,
  );
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
