// KPI-сид (Фаза 1.5). Идемпотентный и БЕЗОПАСНЫЙ для прода: ставит флаг requiresSignedDoc
// ремонтно-арендным типам и заводит дефолты расчёта (веса/профили/настройки). НЕ трогает
// пользователей и пароли (в отличие от prisma/seed.ts) — годится для повторного прогона на бою.
// Запуск напрямую: `pnpm db:seed:kpi`. Также вызывается из prisma/seed.ts.
import "dotenv/config";
import { PrismaClient, type KpiMarkKind } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Типы с актом по умолчанию (PRD §3, §12.1). Должны совпадать с именами в TASK_TYPES сида.
// requiresSignedDoc типа — дефолт для новых задач; фактическое требование живёт на задаче
// (Task.requiresSignedDoc, этап 11) и копируется из типа при создании.
export const REPAIR_TYPE_NAMES = [
  "Выездной ремонт / диагностика",
  "Забор в ремонт",
  "Гарантийный ремонт",
  "Доставка в аренду",
  "Забор с аренды",
];

// Дефолты-заглушки (числа Артёма 17.06.2026). Далее настраиваются админом в UI — поэтому upsert
// только СОЗДАЁТ строки, не перетирая уже настроенные значения.
export const KPI_RULES: { kind: KpiMarkKind; weight: number }[] = [
  { kind: "LATE", weight: 500 },
  { kind: "MISSED_STOP", weight: 500 },
  { kind: "UNSIGNED_DOCS", weight: 1000 },
];

export const PAY_PROFILES: { login: string; baseSalary: number; premiumBase: number }[] = [
  { login: "kashirskiy", baseSalary: 70_000, premiumBase: 40_000 },
  { login: "pisarev", baseSalary: 70_000, premiumBase: 40_000 },
];

export const KPI_SETTINGS = {
  progressionPercent: 110,
  progressionStartIndex: 3,
  floor: "SALARY" as const,
};

/** Идемпотентный KPI-сид. Принимает уже сконфигурированный PrismaClient. */
export async function seedKpi(prisma: PrismaClient): Promise<void> {
  // requiresSignedDoc проставляем существующим типам по имени (updateMany — не создаёт типы).
  let flagged = 0;
  for (const name of REPAIR_TYPE_NAMES) {
    const res = await prisma.taskType.updateMany({ where: { name }, data: { requiresSignedDoc: true } });
    flagged += res.count;
  }
  console.log(`  ✓ requiresSignedDoc проставлен типам: ${flagged}/${REPAIR_TYPE_NAMES.length}`);

  for (const r of KPI_RULES) {
    await prisma.kpiRule.upsert({
      where: { kind: r.kind },
      update: {}, // не перетираем настроенный вес
      create: { kind: r.kind, weight: r.weight, isActive: true },
    });
  }
  console.log(`  ✓ KPI-правила (веса штрафов): ${KPI_RULES.length}`);

  for (const p of PAY_PROFILES) {
    const driver = await prisma.user.findUnique({ where: { login: p.login }, select: { id: true } });
    if (!driver) {
      console.log(`  ⚠ водитель ${p.login} не найден — профиль пропущен`);
      continue;
    }
    await prisma.driverPayProfile.upsert({
      where: { driverId: driver.id },
      update: {}, // не перетираем настроенные оклад/премию
      create: { driverId: driver.id, baseSalary: p.baseSalary, premiumBase: p.premiumBase, isActive: true },
    });
  }
  console.log(`  ✓ денежные профили водителей: ${PAY_PROFILES.length}`);

  await prisma.kpiSettings.upsert({
    where: { id: "singleton" },
    update: {}, // не перетираем настроенную прогрессию/порог
    create: {
      id: "singleton",
      progressionPercent: KPI_SETTINGS.progressionPercent,
      progressionStartIndex: KPI_SETTINGS.progressionStartIndex,
      floor: KPI_SETTINGS.floor,
    },
  });
  console.log("  ✓ настройки расчёта KPI (прогрессия, порог)");
}

// Standalone-запуск (`pnpm db:seed:kpi`) — для прода после миграции.
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL не задан — проверь .env");
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    await seedKpi(prisma);
    console.log("KPI-сид готов.");
  } finally {
    await prisma.$disconnect();
  }
}

// Запускаем main только при прямом вызове файла, не при импорте из seed.ts.
if (process.argv[1] && process.argv[1].includes("seed-kpi")) {
  main().catch((error) => {
    console.error("KPI-сид упал:", error);
    process.exit(1);
  });
}
