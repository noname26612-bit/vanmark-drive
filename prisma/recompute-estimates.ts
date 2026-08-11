// Пересчёт оценок времени по действующим нормам типов (решение Артёма 11.08.2026, PRD §14.1).
//
// Зачем нужен. `Task.estimatedMinutes` — это СНИМОК: он считается при создании заявки и при правке
// адреса/даты/времени/типа. Когда админ меняет норму типа (как 11.08 — доставкам добавили 30 минут
// на выгрузку), уже заведённые заявки остаются со старой цифрой, и «Планирование» с «Календарём»
// показывают загрузку по вчерашним нормам. Этот скрипт приводит их к текущим.
//
// Что трогаем: только НЕзавершённые заявки (не DONE/CANCELLED), не архивные и только с
// `estimateIsManual = false`. Ручные оценки диспетчера — не трогаем никогда: это его решение.
// Геокодер НЕ дёргаем — берём уже сохранённые в заявке координаты (нет координат → «дорога не
// учтена», как и при создании).
//
// Запуск: `pnpm db:recompute-estimates` (сухой прогон: `pnpm db:recompute-estimates -- --dry`).
import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { estimateTask } from "@/domain/capacity";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL не задан — проверь .env");
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

  try {
    const [settings, windows, tasks] = await Promise.all([
      prisma.capacitySettings.findUnique({ where: { id: "singleton" } }),
      prisma.trafficWindow.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.task.findMany({
        where: {
          estimateIsManual: false,
          archivedAt: null,
          status: { notIn: ["DONE", "CANCELLED"] },
        },
        select: {
          id: true,
          number: true,
          lat: true,
          lng: true,
          timeFrom: true,
          estimatedMinutes: true,
          type: { select: { name: true, onSiteMinutes: true } },
        },
        orderBy: { number: "asc" },
      }),
    ]);
    if (!settings) throw new Error("Нет настроек ёмкости (CapacitySettings) — сначала pnpm db:seed:capacity");

    let changed = 0;
    for (const t of tasks) {
      const next = estimateTask({
        onSiteMinutes: t.type.onSiteMinutes,
        base: { lat: settings.baseLat, lng: settings.baseLng },
        point: t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null,
        timeFrom: t.timeFrom,
        windows,
        params: {
          avgSpeedKmh: settings.avgSpeedKmh,
          detourPercent: settings.detourPercent,
          countReturnTrip: settings.countReturnTrip,
        },
      });
      if (next.totalMinutes === t.estimatedMinutes) continue;
      changed += 1;
      console.log(
        `  №${t.number} · ${t.type.name}: ${t.estimatedMinutes ?? "—"} → ${next.totalMinutes} мин`,
      );
      if (!dry) {
        await prisma.task.update({ where: { id: t.id }, data: { estimatedMinutes: next.totalMinutes } });
      }
    }
    console.log(
      dry
        ? `Сухой прогон: пересчитались бы ${changed} из ${tasks.length} заявок (ничего не записано).`
        : `Готово: пересчитано ${changed} из ${tasks.length} заявок.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Пересчёт оценок упал:", error);
  process.exit(1);
});
