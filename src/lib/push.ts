import "server-only";
// Транспорт web-push (ARCHITECTURE §8). VAPID-ключи — из env (CLAUDE.md правило 5).
// server-only: гарантирует, что приватный VAPID-ключ никогда не попадёт в клиентский бандл.
// Отправка best-effort: вызывается из доменных мутаций fire-and-forget и НИКОГДА не должна
// ронять мутацию. Протухшие подписки (HTTP 404/410) удаляются из БД.
import webpush, { type WebPushError } from "web-push";
import { prisma } from "@/lib/prisma";
import {
  buildTaskPayload,
  buildCoDriverPayload,
  buildPricingRequestPayload,
  type PushPayload,
  type TaskNotifyKind,
  type NotifiableTask,
} from "@/domain/notifications";

let configured: boolean | null = null;

// Лениво конфигурируем VAPID один раз. Нет ключей — пуши тихо выключены (dev без .env).
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@van-mark.ru";
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID ключи не заданы — web-push отключён");
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

const DEAD_STATUS = new Set([404, 410]); // 404 — невалидный endpoint, 410 — подписка истекла

function isWebPushError(e: unknown): e is WebPushError {
  return typeof e === "object" && e !== null && "statusCode" in e;
}

/**
 * Отправить пуш всем устройствам пользователя. userId задаёт ВЫЗЫВАЮЩИЙ код из доменной мутации
 * (из сессии), не из запроса. Ошибки не пробрасываются (best-effort). allSettled — одна мёртвая
 * подписка не мешает доставке на другие устройства.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;

  const body = JSON.stringify(payload); // заведомо < ~4 КБ (минимальная нагрузка)
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60, urgency: "high" },
        );
      } catch (e) {
        if (isWebPushError(e) && DEAD_STATUS.has(e.statusCode)) {
          await prisma.pushSubscription
            .deleteMany({ where: { endpoint: s.endpoint } })
            .catch(() => {});
        } else {
          console.error(
            "[push] sendNotification error:",
            isWebPushError(e) ? e.statusCode : undefined,
            (e as Error).message,
          );
        }
      }
    }),
  );
}

/**
 * Уведомить участников задачи об изменении (fire-and-forget). Вызывается из доменных мутаций
 * ПОСЛЕ коммита. Не уведомляем того, кто сам совершил действие (он и так знает).
 * Напарник (20.07.2026, PRD §7): изменения/переносы/отмены/расценка приходят ОБОИМ; «assigned»
 * напарнику не дублируем — при добавлении в пару ему уходит отдельный notifyCoDriverAssigned.
 */
export function notifyTaskAssignee(
  task: NotifiableTask & { assigneeId: string | null; coDriverId?: string | null },
  kind: TaskNotifyKind,
  actorId?: string,
): void {
  const payload = buildTaskPayload(task, kind);
  if (task.assigneeId && task.assigneeId !== actorId) {
    void sendPushToUser(task.assigneeId, payload).catch(() => {});
  }
  const coDriverId = task.coDriverId ?? null;
  if (kind !== "assigned" && coDriverId && coDriverId !== actorId) {
    void sendPushToUser(coDriverId, payload).catch(() => {});
  }
}

/** Пуш водителю, добавленному в пару напарником («Ты напарник по заявке №N»). */
export function notifyCoDriverAssigned(
  task: NotifiableTask & { coDriverId?: string | null; assignee?: { name: string } | null },
  actorId?: string,
): void {
  const coDriverId = task.coDriverId ?? null;
  if (!coDriverId || coDriverId === actorId) return;
  void sendPushToUser(coDriverId, buildCoDriverPayload(task, task.assignee?.name)).catch(() => {});
}

/**
 * Уведомить диспетчеров/админов, что водитель отправил ведомость на расценку (этап 13, PRD §13.1).
 * Шлём всем активным диспетчерам/админам с возможностью входа (fire-and-forget, после коммита).
 */
export function notifyDispatchers(task: NotifiableTask): void {
  void (async () => {
    const dispatchers = await prisma.user.findMany({
      where: { role: { in: ["DISPATCHER", "ADMIN"] }, isActive: true, canLogin: true },
      select: { id: true },
    });
    const payload = buildPricingRequestPayload(task);
    await Promise.allSettled(dispatchers.map((d) => sendPushToUser(d.id, payload)));
  })().catch(() => {});
}
