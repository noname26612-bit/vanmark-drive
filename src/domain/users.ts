// Запросы по пользователям для экранов диспетчера.
import { prisma } from "@/lib/prisma";

/** Активные водители для колонок доски и выбора исполнителя (включая внешних без входа). */
export function listActiveDrivers() {
  return prisma.user.findMany({
    where: { role: "DRIVER", isActive: true },
    select: { id: true, name: true, canLogin: true },
    orderBy: { name: "asc" },
  });
}
