// Разбор тела запроса задачи из untrusted JSON в типизированный вход домена.
// Это тот самый «обоснованный unknown-парсинг» из CLAUDE.md: на выходе — один контролируемый
// каст к Partial<CreateTaskInput>, дальше домен валидирует обязательные поля сам.
import type { CreateTaskInput } from "@/domain/task-service";
import type { TaskTypeInput } from "@/domain/task-type-service";
import { PassStatus, PaymentType, TaskStatus } from "@/generated/prisma/enums";

/** Разбор полей типа задачи (справочник админа). */
export function parseTaskTypeFields(body: Record<string, unknown>): Partial<TaskTypeInput> {
  const out: Partial<TaskTypeInput> = {};
  if (typeof body.name === "string") out.name = body.name;
  if ("icon" in body) {
    const v = body.icon;
    if (v === null || typeof v === "string") out.icon = v;
  }
  if (typeof body.requiresPhoto === "boolean") out.requiresPhoto = body.requiresPhoto;
  if (typeof body.sortOrder === "number") out.sortOrder = Math.trunc(body.sortOrder);
  if (typeof body.isActive === "boolean") out.isActive = body.isActive;
  return out;
}

/** Валидирует строку как статус задачи (для эндпоинта перехода/фильтров). */
export function parseStatus(v: unknown): TaskStatus | undefined {
  return typeof v === "string" && Object.values(TaskStatus).includes(v as TaskStatus)
    ? (v as TaskStatus)
    : undefined;
}

const NULLABLE_STRINGS = [
  "description",
  "equipment",
  "orgName",
  "contactName",
  "contactPhone",
  "addressLink",
  "invoiceNumber",
  "paymentNote",
  "scheduledDate",
  "timeFrom",
  "timeTo",
  "timeNote",
] as const;

const REQUIRED_STRINGS = ["typeId", "title", "address"] as const;

function isPaymentType(v: unknown): v is PaymentType {
  return typeof v === "string" && Object.values(PaymentType).includes(v as PaymentType);
}
function isPassStatus(v: unknown): v is PassStatus {
  return typeof v === "string" && Object.values(PassStatus).includes(v as PassStatus);
}

export function parseTaskFields(body: Record<string, unknown>): Partial<CreateTaskInput> {
  const out: Record<string, unknown> = {};

  for (const k of NULLABLE_STRINGS) {
    if (k in body) {
      const v = body[k];
      if (v === null || typeof v === "string") out[k] = v;
    }
  }
  for (const k of REQUIRED_STRINGS) {
    if (k in body && typeof body[k] === "string") out[k] = body[k];
  }
  if (isPaymentType(body.paymentType)) out.paymentType = body.paymentType;
  if (isPassStatus(body.passStatus)) out.passStatus = body.passStatus;
  if ("paymentAmount" in body) {
    const v = body.paymentAmount;
    out.paymentAmount = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
  }
  if (typeof body.priority === "boolean") out.priority = body.priority;
  if ("assigneeId" in body) {
    const v = body.assigneeId;
    if (v === null || typeof v === "string") out.assigneeId = v;
  }

  return out as Partial<CreateTaskInput>;
}
