// Чистые билдеры полезной нагрузки пушей и валидация подписки (PRD §7, ARCHITECTURE §8).
// Здесь НЕТ web-push, prisma и server-only — модуль импортируется юнит-тестами (vitest, node).
// Транспорт (отправка) — в src/lib/push.ts.

// Минимальная нагрузка пуша (ARCHITECTURE §8): заголовок/тело + deeplink в карточку.
export type PushPayload = {
  title: string;
  body: string;
  url?: string; // тап по пушу открывает PWA здесь
  tag?: string; // пуши с одинаковым tag схлопываются
};

export type TaskNotifyKind = "assigned" | "changed" | "rescheduled" | "cancelled" | "priced";

export type NotifiableTask = {
  id: string;
  number: number;
  title: string;
  type?: { name: string } | null;
};

const TASK_TITLE: Record<TaskNotifyKind, string> = {
  assigned: "Новая задача",
  changed: "Задача изменена",
  rescheduled: "Задача перенесена",
  cancelled: "Задача отменена",
  priced: "Цены готовы",
};

export function buildTaskPayload(task: NotifiableTask, kind: TaskNotifyKind): PushPayload {
  const typeName = task.type?.name ? `${task.type.name}: ` : "";
  return {
    title: `${TASK_TITLE[kind]} №${task.number}`,
    body: `${typeName}${task.title}`,
    url: `/m/${task.id}`,
    tag: `task-${task.id}`,
  };
}

// Пуш диспетчеру: водитель отправил ведомость на расценку (этап 13, PRD §13.1). Ведёт на карточку
// задачи у диспетчера (не /m/), т.к. расценивает диспетчер.
export function buildPricingRequestPayload(task: NotifiableTask): PushPayload {
  const typeName = task.type?.name ? `${task.type.name}: ` : "";
  return {
    title: `Ведомость на расценку №${task.number}`,
    body: `${typeName}${task.title} — водитель ждёт цен`,
    url: `/tasks/${task.id}`,
    tag: `pricing-${task.id}`,
  };
}

// Утреннее напоминание водителю (08:00, PRD §7).
export function buildMorningPayload(taskCount: number): PushPayload {
  return {
    title: "Задачи на сегодня",
    body: `У тебя ${taskCount} ${pluralTasks(taskCount)} на сегодня`,
    url: "/m",
    tag: "morning-reminder",
  };
}

// Вечерний обход актов (20:05, решение Артёма 02.07): диспетчеру — по скольким задачам акт
// не приложен к дедлайну 20:00. Тап ведёт на экран KPI, где кандидаты разбираются.
export function buildActViolationsPayload(taskCount: number): PushPayload {
  return {
    title: "Акты не приложены",
    body: `${taskCount} ${pluralTasks(taskCount)} без акта к 20:00 — разберите нарушения`,
    url: "/kpi",
    tag: "act-deadline",
  };
}

// Предупреждение диспетчеру о незаказанных пропусках на завтра (16:00, PRD §6/§7).
export function buildPassWarningPayload(taskCount: number): PushPayload {
  return {
    title: "Пропуска на завтра",
    body: `${taskCount} ${pluralTasks(taskCount)} на завтра без заказанного пропуска`,
    url: "/board",
    tag: "pass-warning",
  };
}

// Склонение «задача/задачи/задач».
export function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "задача";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "задачи";
  return "задач";
}

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/**
 * Валидация тела подписки от клиента ({ endpoint, keys: { p256dh, auth } }).
 * Возвращает нормализованный объект или null. endpoint должен быть https.
 */
export function validateSubscriptionInput(body: unknown): SubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const endpoint = typeof b.endpoint === "string" ? b.endpoint : null;
  const keys =
    b.keys && typeof b.keys === "object" ? (b.keys as Record<string, unknown>) : null;
  const p256dh = keys && typeof keys.p256dh === "string" ? keys.p256dh : null;
  const auth = keys && typeof keys.auth === "string" ? keys.auth : null;
  if (!endpoint || !p256dh || !auth) return null;
  if (!/^https:\/\//.test(endpoint)) return null;
  return { endpoint, p256dh, auth };
}
