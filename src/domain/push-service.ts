// Доменный сервис push-подписок и плановых напоминаний (ARCHITECTURE §8).
// Изоляция (CLAUDE.md правило 1): подписка привязывается к userId ИЗ СЕССИИ (аргумент), не из тела.
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { Errors } from "./errors";
import {
  validateSubscriptionInput,
  buildMorningPayload,
  buildPassWarningPayload,
  buildCloseShiftPayload,
  buildBirthdaySoonPayload,
  buildBirthdayTodayPayload,
  buildBirthdayGreetingPayload,
} from "./notifications";
import { birthdaysOn, formatBirthdayLabel, type BirthdayPerson } from "./birthdays";

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
          archivedAt: null, // убранную в архив заявку в «у тебя N задач» не считаем (11.08.2026)
        },
      });
      if (count > 0) await sendPushToUser(d.id, buildMorningPayload(count));
    }),
  );
}

/**
 * 21:00 — водителям, у кого смена за сегодня всё ещё открыта: «закройте смену» (решение Артёма 03.08).
 * Внешний перевозчик смен не ведёт, поэтому в выборку не попадает по определению (смены у него нет).
 */
export async function runCloseShiftReminders(): Promise<void> {
  const today = moscowDateAt(0);
  const shifts = await prisma.shift.findMany({
    where: { date: today, status: { in: ["REQUESTED", "OPEN"] }, driver: { isActive: true, canLogin: true } },
    select: { driverId: true },
  });
  await Promise.all(shifts.map((s) => sendPushToUser(s.driverId, buildCloseShiftPayload())));
}

// Дата в таймзоне РФ как ключ «YYYY-MM-DD» — для сравнения дней рождения (день и месяц).
function moscowDateKey(offsetDays: number): string {
  return moscowDateAt(offsetDays).toISOString().slice(0, 10);
}

/**
 * 09:00 — дни рождения коллег (решение Артёма 18.08.2026, PRD §18). Два повода в одной задаче:
 * за 3 дня (успеть подготовиться) и в сам день (не забыть поздравить). Имениннику вместо
 * напоминания о себе приходит поздравление.
 *
 * Получатели — действующие сотрудники компании со входом в систему: внешний перевозчик не коллега,
 * а у сотрудников без входа (EMPLOYEE) и подписок-то нет. Именинника из своей же рассылки исключаем.
 * Дедупликация не нужна: задача суточная, как и остальные напоминания (src/lib/cron.ts).
 */
export async function runBirthdayReminders(): Promise<void> {
  const rows = await prisma.user.findMany({
    where: { isActive: true, isExternal: false, birthday: { not: null } },
    select: { id: true, name: true, birthday: true },
  });
  if (rows.length === 0) return;
  const people: BirthdayPerson[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    birthday: u.birthday ? u.birthday.toISOString().slice(0, 10) : null,
  }));

  const todayCelebrating = birthdaysOn(people, moscowDateKey(0));
  const soonCelebrating = birthdaysOn(people, moscowDateKey(3));
  if (todayCelebrating.length === 0 && soonCelebrating.length === 0) return;

  const recipients = await prisma.user.findMany({
    where: { isActive: true, canLogin: true, isExternal: false },
    select: { id: true },
  });

  const sends: Promise<void>[] = [];
  for (const person of soonCelebrating) {
    const payload = buildBirthdaySoonPayload(person.name, formatBirthdayLabel(person.birthday), person.id);
    for (const r of recipients) {
      if (r.id !== person.id) sends.push(sendPushToUser(r.id, payload));
    }
  }
  for (const person of todayCelebrating) {
    const payload = buildBirthdayTodayPayload(person.name, person.id);
    for (const r of recipients) {
      if (r.id !== person.id) sends.push(sendPushToUser(r.id, payload));
    }
    // Имениннику — поздравление. Если у него нет входа или подписок, отправка тихо ничего не сделает.
    sends.push(sendPushToUser(person.id, buildBirthdayGreetingPayload(person.name)));
  }
  await Promise.allSettled(sends);
}

/** 16:00 — диспетчерам: на завтра есть N задач с пропуском «нужен, не заказан». */
export async function runPassWarnings(): Promise<void> {
  const tomorrow = moscowDateAt(1);
  const count = await prisma.task.count({
    where: {
      scheduledDate: tomorrow,
      passStatus: "NEEDED",
      status: { notIn: ["DONE", "CANCELLED"] },
      archivedAt: null,
    },
  });
  if (count === 0) return;
  const dispatchers = await prisma.user.findMany({
    where: { role: "DISPATCHER", isActive: true },
    select: { id: true },
  });
  await Promise.all(dispatchers.map((u) => sendPushToUser(u.id, buildPassWarningPayload(count))));
}
