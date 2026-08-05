// Разбор тела запросов модуля «Станки» из untrusted JSON в типизированный вход домена.
// Тот же «обоснованный unknown-парсинг», что в task-input.ts: один контролируемый каст,
// обязательные поля и бизнес-правила проверяет домен (machine-service).
import type { EditMachineInput } from "@/domain/machine-service";
import { MachineCategory, MachineStatus } from "@/generated/prisma/enums";

export function parseCategory(v: unknown): MachineCategory | undefined {
  return typeof v === "string" && Object.values(MachineCategory).includes(v as MachineCategory)
    ? (v as MachineCategory)
    : undefined;
}

export function parseMachineStatus(v: unknown): MachineStatus | undefined {
  return typeof v === "string" && Object.values(MachineStatus).includes(v as MachineStatus)
    ? (v as MachineStatus)
    : undefined;
}

// Строковые поля карточки. Пустая строка доходит до домена как есть и означает «очистить поле».
const STRINGS = [
  "model",
  "configuration",
  "metalThickness",
  "serialNumber",
  "orgName",
  "contactName",
  "contactPhone",
  "invoice1C",
  "deliveredBy",
  "location",
  "defectNotes",
  "notes",
  "arrivedAt",
  "responsibleId",
] as const;

export function parseMachineFields(body: Record<string, unknown>): EditMachineInput {
  const out: Record<string, unknown> = {};

  for (const key of STRINGS) {
    if (key in body) {
      const v = body[key];
      if (v === null || typeof v === "string") out[key] = v;
    }
  }
  if (typeof body.isUrgent === "boolean") out.isUrgent = body.isUrgent;
  if ("ourNumber" in body) {
    const v = body.ourNumber;
    out.ourNumber = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
  }

  return out as EditMachineInput;
}

/** Флаг-плитка сводки, по которой фильтруется список (белый список — из query приходит что угодно). */
const FLAGS = ["noInvoice1C", "urgent", "awaitingDiagnosis", "staleVerification"] as const;
export type MachineFlagFilter = (typeof FLAGS)[number];

export function parseFlag(v: string | null): MachineFlagFilter | undefined {
  return FLAGS.includes(v as MachineFlagFilter) ? (v as MachineFlagFilter) : undefined;
}

/** Целое из query (take/skip). Некорректное — undefined, домен подставит значение по умолчанию. */
export function parseInt0(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
}
