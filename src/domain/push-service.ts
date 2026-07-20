// Доменный сервис push-подписок и плановых напоминаний (ARCHITECTURE §8).
// Изоляция (CLAUDE.md правило 1): подписка привязывается к userId ИЗ СЕССИИ (аргумент), не из тела.
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { Errors } from "./errors";
import {
  validateSubscriptionInput,
  buildMorningPayload,
  buildPassWarningPayload,
} from "./notifications";

// --- Подписки -------------------------------------------------------------

/** Сохранить/обновить подписку устройства. endpoint уникален → повторная подписка не плодит дубли. */
export async function saveSubscription(
  userId: string,
  body: unknown,
  userAgent?: string | null,
): Promise<void> {
  const input = validateSubscriptionInput(body);
  if (!input) throw Errors.validation("Некорректная подписка");
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: { userId, p256dh: input.p256dh, auth: input.auth, userAgent: userAgent ?? undefined },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: userAgent ?? null,
    },
  });
}

/** Удалить подписку. Только свою (userId из сессии) — чужую тронуть нельзя. */
export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  const ep = endpoint?.trim();
  if (!ep) throw Errors.validation("endpoint не задан");
  await prisma.pushSubscription.deleteMany({ where: { endpoint: ep, userId } });
}

// --- Плановые напоминания (node-cron, см. src/lib/cron.ts) -----------------

// Дата в таймзоне РФ → Date на UTC-полночь (совпадает с @db.Date и parseDate в task-service).
function moscowDateAt(offsetDays: number): Date {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }); // YYYY-MM-DD
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

/** 08:00 — каждому активному водителю с входом: «у тебя N задач на сегодня» (если N>0). */
export async function runMorningReminders(): Promise<void> {
  const today = moscowDateAt(0);
  const drivers = await prisma.user.findMany({
    where: { role: "DRIVER", isActive: true, canLogin: true },
    select: { id: true },
  });
  await Promise.all(
    drivers.map(async (d) => {
      const count = await prisma.task.count({
        // Парные задачи (напарник) занимают день так же, как свои (PRD §7, 20.07.2026).
        where: {
          OR: [{ assigneeId: d.id }, { coDriverId: d.id }],
          scheduledDate: today,
          status: { notIn: ["DONE", "CANCELLED"] },
        },
      });
      if (count > 0) await sendPushToUser(d.id, buildMorningPayload(count));
    }),
  );
}

/** 16:00 — диспетчерам: на завтра есть N задач с пропуском «нужен, не заказан». */
export async function runPassWarnings(): Promise<void> {
  const tomorrow = moscowDateAt(1);
  const count = await prisma.task.count({
    where: {
      scheduledDate: tomorrow,
      passStatus: "NEEDED",
      status: { notIn: ["DONE", "CANCELLED"] },
    },
  });
  if (count === 0) return;
  const dispatchers = await prisma.user.findMany({
    where: { role: "DISPATCHER", isActive: true },
    select: { id: true },
  });
  await Promise.all(dispatchers.map((u) => sendPushToUser(u.id, buildPassWarningPayload(count))));
}
