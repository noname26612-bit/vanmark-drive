// Сериализуемые типы KPI для границы сервер↔клиент (как task-dto). Без импортов prisma-клиента,
// чтобы безопасно использоваться в клиентских компонентах. Источник арифметики — src/domain/kpi.ts.
import type { KpiMarkKind, KpiMarkStatus, PayoutFloor } from "@/generated/prisma/enums";
import type { BreakdownItem, ActBonusResult } from "@/domain/kpi";

export type { BreakdownItem, ActBonusResult };

// Бонус за комплектность актов в расчёте водителя (этап 15, PRD §12.6).
export type ActBonusView = ActBonusResult;

export type MarkView = {
  id: string;
  driverId: string;
  driverName: string;
  taskId: string | null;
  taskNumber: number | null;
  taskTitle: string | null;
  period: string;
  kind: KpiMarkKind;
  status: KpiMarkStatus;
  occurredAt: string;
  note: string | null;
  manualAmount: number | null;
  resolvedById: string | null;
  resolvedAt: string | null;
};

export type DriverPayrollView = {
  driverId: string;
  driverName: string;
  period: string;
  closed: boolean;
  baseSalary: number;
  premiumBase: number;
  penalty: number;
  bonus: number;
  actBonus: ActBonusView; // бонус за комплектность актов (этап 15, PRD §12.6)
  premiumAfter: number;
  total: number; // включает actBonus.value
  breakdown: BreakdownItem[];
  marks: MarkView[];
};

export type KpiOverview = {
  period: string;
  closed: boolean;
  candidates: MarkView[];
  drivers: DriverPayrollView[];
};

export type PayProfileView = {
  driverId: string;
  driverName: string;
  login: string;
  baseSalary: number;
  premiumBase: number;
  isActive: boolean;
};

export type KpiRuleView = { kind: KpiMarkKind; weight: number; isActive: boolean };

export type KpiSettingsView = {
  progressionPercent: number;
  progressionStartIndex: number;
  floor: PayoutFloor;
  actBonusAmount: number; // сумма бонуса за комплектность актов, ₽ (этап 15)
  actBonusThresholdPercent: number; // порог комплектности для бонуса, % (этап 15)
};

// Подписи видов нарушений для интерфейса (русский, кратко).
export const KPI_KIND_LABEL: Record<KpiMarkKind, string> = {
  LATE: "Опоздание",
  UNSIGNED_DOCS: "Без акта",
  MISSED_STOP: "Невыполненная точка",
  MANUAL: "Ручная отметка",
};

// Цвет бейджа вида нарушения (палитра ui-guidelines: оранжевый/красный/жёлтый/нейтральный).
export const KPI_KIND_BADGE: Record<KpiMarkKind, string> = {
  LATE: "bg-orange-100 text-orange-700",
  UNSIGNED_DOCS: "bg-red-100 text-red-700",
  MISSED_STOP: "bg-amber-100 text-amber-800",
  MANUAL: "bg-slate-100 text-slate-700",
};

// Русское склонение числительного: pluralRu(2, ["акт","акта","актов"]) → "акта".
function pluralRu(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// Текст и тон прогресса бонуса за комплектность актов (этап 15, PRD §12.6) — для водителя и Милены.
export function actBonusSummary(ab: ActBonusView): { text: string; tone: "green" | "amber" | "neutral" } {
  const amount = ab.amount.toLocaleString("ru-RU");
  if (ab.base === 0) {
    return { text: "За месяц нет актовых задач — бонус не считается", tone: "neutral" };
  }
  const ratio = `Акты ${ab.complete}/${ab.base} = ${ab.percent}%`;
  if (ab.awarded) {
    return { text: `${ratio} → бонус ${amount} ₽ начислен`, tone: "green" };
  }
  // Закрытый месяц финализирован (missing=0) — без «не хватает», бонус просто не начислен.
  if (ab.missing === 0) {
    return { text: `${ratio} — бонус за акты не начислен`, tone: "neutral" };
  }
  // «ещё N актов» — счётное (именительное) сочетание, обычная парадигма склонения.
  const acts = pluralRu(ab.missing, ["акт", "акта", "актов"]);
  return { text: `${ratio} — ещё ${ab.missing} ${acts} до бонуса ${amount} ₽`, tone: "amber" };
}
