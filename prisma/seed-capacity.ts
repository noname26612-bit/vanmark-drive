// Сид параметров ёмкости (Фаза 2, PRD §14). Идемпотентный и БЕЗОПАСНЫЙ для прода: обновляет
// нормы времени у существующих типов (по имени), специализацию водителей (по логину) и заводит
// настройки расчёта (CapacitySettings) и окна пробок (TrafficWindow). НЕ трогает пользователей и
// пароли (в отличие от prisma/seed.ts). Запуск напрямую: `pnpm db:seed:capacity`. Также вызывается
// из prisma/seed.ts. Данные — решения Артёма 19.06.2026.
import "dotenv/config";
import { PrismaClient, type DriverSpecialization } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Нормы работы на объекте, мин (PRD §14.2). Имена обязаны совпадать с TASK_TYPES в prisma/seed.ts.
// Сид выставляет нормы из спеки; как и прочие атрибуты типов, повторный сид их перезапишет —
// калибровать удобнее в админке /admin/task-types (там же подсказка фактического среднего).
export const ON_SITE_MINUTES: Record<string, number> = {
  "Выездной ремонт / диагностика": 90,
  "Гарантийный ремонт": 90,
  "Сдача в ТК": 60,
  "Забрать посылку": 60,
  "Доставка в аренду": 30,
  "Забор в ремонт": 30,
  "Доставка из ремонта": 30,
  "Доставка проданного оборудования": 30,
  "Закупка/выкуп станка": 30,
  "Забор с аренды": 40,
  Прочее: 30,
};

// Специализация водителей для подсказки «кто свободен» (PRD §14.5). По логину.
export const DRIVER_SPECIALIZATION: Record<string, DriverSpecialization> = {
  kashirskiy: "REPAIR",
  pisarev: "DELIVERY",
  sultan: "DELIVERY",
};

// Настройки расчёта (singleton). База — координаты Артёма; параметры — §14.1.
export const CAPACITY_SETTINGS = {
  baseLat: 55.959611,
  baseLng: 37.864076,
  workdayMinutes: 480, // 9–18 минус час обеда
  avgSpeedKmh: 50,
  detourPercent: 110, // ×1.1
  countReturnTrip: false,
};

// Окна пробок (PRD §14.3) + ночь 00:00–04:00 для покрытия суток. from включ., to исключая.
export const TRAFFIC_WINDOWS: { fromMinutes: number; toMinutes: number; factorPercent: number; sortOrder: number }[] = [
  { fromMinutes: 0, toMinutes: 240, factorPercent: 100, sortOrder: 1 }, // 00:00–04:00
  { fromMinutes: 240, toMinutes: 420, factorPercent: 100, sortOrder: 2 }, // 04:00–07:00
  { fromMinutes: 420, toMinutes: 480, factorPercent: 130, sortOrder: 3 }, // 07:00–08:00
  { fromMinutes: 480, toMinutes: 570, factorPercent: 140, sortOrder: 4 }, // 08:00–09:30
  { fromMinutes: 570, toMinutes: 630, factorPercent: 130, sortOrder: 5 }, // 09:30–10:30
  { fromMinutes: 630, toMinutes: 960, factorPercent: 120, sortOrder: 6 }, // 10:30–16:00
  { fromMinutes: 960, toMinutes: 1020, factorPercent: 130, sortOrder: 7 }, // 16:00–17:00
  { fromMinutes: 1020, toMinutes: 1140, factorPercent: 140, sortOrder: 8 }, // 17:00–19:00
  { fromMinutes: 1140, toMinutes: 1200, factorPercent: 120, sortOrder: 9 }, // 19:00–20:00
  { fromMinutes: 1200, toMinutes: 1440, factorPercent: 100, sortOrder: 10 }, // 20:00–24:00
];

/** Идемпотентный сид ёмкости. Принимает уже сконфигурированный PrismaClient. */
export async function seedCapacity(prisma: PrismaClient): Promise<void> {
  // Нормы времени по типам (updateMany по имени — типы не создаём, они из основного сида).
  let normed = 0;
  for (const [name, onSiteMinutes] of Object.entries(ON_SITE_MINUTES)) {
    const res = await prisma.taskType.updateMany({ where: { name }, data: { onSiteMinutes } });
    normed += res.count;
  }
  console.log(`  ✓ нормы времени по типам: ${normed}/${Object.keys(ON_SITE_MINUTES).length}`);

  // Специализация водителей (update по логину; если кого-то нет — пропускаем).
  let specced = 0;
  for (const [login, specialization] of Object.entries(DRIVER_SPECIALIZATION)) {
    const res = await prisma.user.updateMany({ where: { login }, data: { specialization } });
    specced += res.count;
  }
  console.log(`  ✓ специализация водителей: ${specced}/${Object.keys(DRIVER_SPECIALIZATION).length}`);

  // Настройки расчёта (singleton). update {} — не перетираем то, что админ настроил в UI.
  await prisma.capacitySettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", ...CAPACITY_SETTINGS },
  });
  console.log("  ✓ настройки расчёта ёмкости (база, рабочий день, скорость, петляние)");

  // Окна пробок: заводим дефолтный набор только если их ещё нет (иначе уважаем правки админа).
  const existing = await prisma.trafficWindow.count();
  if (existing === 0) {
    await prisma.trafficWindow.createMany({ data: TRAFFIC_WINDOWS });
    console.log(`  ✓ окна пробок: создано ${TRAFFIC_WINDOWS.length}`);
  } else {
    console.log(`  ✓ окна пробок: уже заданы (${existing}) — не трогаю`);
  }
}

// Standalone-запуск (`pnpm db:seed:capacity`) — для прода после миграции.
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL не задан — проверь .env");
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    await seedCapacity(prisma);
    console.log("Сид ёмкости готов.");
  } finally {
    await prisma.$disconnect();
  }
}

// Запускаем main только при прямом вызове файла, не при импорте из seed.ts.
if (process.argv[1] && process.argv[1].includes("seed-capacity")) {
  main().catch((error) => {
    console.error("Сид ёмкости упал:", error);
    process.exit(1);
  });
}
