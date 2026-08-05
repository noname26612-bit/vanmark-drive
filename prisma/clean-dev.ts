// Очистка локальной dev-БД от накопленных тестовых данных (03.08.2026).
//
// Зачем: e2e гоняются против одной общей dev-БД и каждый прогон создаёт задачи. За несколько
// месяцев их накопились полторы тысячи — списки «Все задачи» и доска переполняются, свежая заявка
// не попадает на первую страницу, и часть тестов начинает «плавать» без изменений в коде.
//
// Что удаляем: задачи со всей их обвязкой (события, вложения, ведомости, KPI-отметки), смены,
// пометки простоя и отсутствия. Что НЕ трогаем: пользователей, пароли, справочники типов и работ,
// настройки KPI и ёмкости, денежные профили — иначе после чистки придётся заново настраивать стенд.
//
// Защита: скрипт отказывается работать, если база не локальная. Прод чистить этим нельзя.
import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  if (!isLocal) {
    console.error(
      "Отказ: DATABASE_URL не выглядит локальным. Этот скрипт только для dev-стенда.\n" +
        "Боевые данные удалять нельзя (CLAUDE.md, правило 7).",
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Отказ: NODE_ENV=production.");
    process.exit(1);
  }
}

// Prisma 7 подключается через driver-адаптер (как в src/lib/prisma.ts).
assertLocalDatabase();
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

async function main(): Promise<void> {
  const before = {
    tasks: await prisma.task.count(),
    events: await prisma.taskEvent.count(),
    shifts: await prisma.shift.count(),
    machines: await prisma.machine.count(),
  };
  console.log(
    `До очистки: задач ${before.tasks}, событий ${before.events}, смен ${before.shifts}, ` +
      `станков ${before.machines}`,
  );

  // Порядок важен: сначала то, что ссылается на задачи и смены, потом сами задачи и смены.
  await prisma.kpiMark.deleteMany({});
  await prisma.workItem.deleteMany({});
  await prisma.attachment.deleteMany({});
  await prisma.taskEvent.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.driverIdleNote.deleteMany({});
  await prisma.driverAbsence.deleteMany({});
  await prisma.processedAction.deleteMany({});

  // Картотека станков (модуль «Станки»): e2e плодит тестовые карточки в той же dev-БД, и без
  // очистки они копятся так же, как копились задачи. Порядок тот же: сначала ссылки, потом станки.
  await prisma.machineEvent.deleteMany({});
  await prisma.machineAttachment.deleteMany({});
  await prisma.machine.deleteMany({});

  // Номера заявок и станков начинаем заново — иначе на чистом стенде первая запись получит номер
  // за тысячу.
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE task_number_seq RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE machine_number_seq RESTART WITH 1`);

  console.log(
    `После очистки: задач ${await prisma.task.count()}, событий ${await prisma.taskEvent.count()}, ` +
      `смен ${await prisma.shift.count()}, станков ${await prisma.machine.count()}. ` +
      `Пользователи, справочники и настройки сохранены.`,
  );
}

main()
  .catch((error) => {
    console.error("Очистка упала:", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
