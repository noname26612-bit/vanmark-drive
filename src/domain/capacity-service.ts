// Сервис ёмкости (Фаза 2, ARCHITECTURE §4б): связывает чистое ядро capacity.ts с настройками из
// БД (CapacitySettings/TrafficWindow). Чтение конфигурации + расчёт оценки одной задачи.
// Агрегация загрузки по водителям×дням для календаря (этап 17) добавится сюда же.
import { prisma } from "@/lib/prisma";
import type { DriverSpecialization } from "@/generated/prisma/enums";
import { Errors } from "./errors";
import { listAbsencesInRange, type AbsenceView } from "./absence-service";
import {
  estimateTask,
  type CapacityParams,
  type EstimateResult,
  type LatLng,
  type TrafficWindow,
} from "./capacity";

// Запасные значения, если singleton-настройки ещё не засеяны (совпадают со схемой/сидом §14).
const FALLBACK = {
  baseLat: 55.959611,
  baseLng: 37.864076,
  workdayMinutes: 480,
  avgSpeedKmh: 50,
  detourPercent: 110,
  countReturnTrip: false,
};

export type CapacityConfig = {
  base: LatLng;
  params: CapacityParams;
  windows: TrafficWindow[];
  workdayMinutes: number;
};

// Грузит настройки расчёта и окна пробок. Один вызов — два лёгких запроса; для частоты создания
// задач (≈10–30/день) это незаметно.
export async function loadCapacityConfig(): Promise<CapacityConfig> {
  const [settings, windows] = await Promise.all([
    prisma.capacitySettings.findUnique({ where: { id: "singleton" } }),
    prisma.trafficWindow.findMany({ orderBy: { fromMinutes: "asc" } }),
  ]);
  const s = settings ?? FALLBACK;
  return {
    base: { lat: s.baseLat, lng: s.baseLng },
    params: {
      avgSpeedKmh: s.avgSpeedKmh,
      detourPercent: s.detourPercent,
      countReturnTrip: s.countReturnTrip,
    },
    windows: windows.map((w) => ({
      fromMinutes: w.fromMinutes,
      toMinutes: w.toMinutes,
      factorPercent: w.factorPercent,
    })),
    workdayMinutes: s.workdayMinutes,
  };
}

export type EstimateArgs = {
  onSiteMinutes: number;
  point: LatLng | null; // null — адрес не геокодирован (оценка без дороги)
  timeFrom: string | null | undefined;
};

// Оценка времени одной задачи. config можно передать заранее (батч), иначе грузится сам.
export async function computeEstimate(
  args: EstimateArgs,
  config?: CapacityConfig,
): Promise<EstimateResult> {
  const cfg = config ?? (await loadCapacityConfig());
  return estimateTask({
    onSiteMinutes: args.onSiteMinutes,
    base: cfg.base,
    point: args.point,
    timeFrom: args.timeFrom,
    params: cfg.params,
    windows: cfg.windows,
  });
}

// ───────────────────────── Админ-настройки ёмкости (ARCHITECTURE §4б) ─────────────────────────
// Чтение/запись настроек, окон пробок и специализации водителей. Вызывается за requireAdmin
// (route-level), как у kpi-settings. Окна и спецификация валидируются здесь.

// Singleton настроек: вернуть существующий или создать с дефолтами схемы.
export async function getCapacitySettings() {
  return prisma.capacitySettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

export type CapacitySettingsInput = {
  baseLat: number;
  baseLng: number;
  workdayMinutes: number;
  avgSpeedKmh: number;
  detourPercent: number;
  countReturnTrip: boolean;
};

export async function updateCapacitySettings(input: CapacitySettingsInput) {
  if (input.baseLat < -90 || input.baseLat > 90 || input.baseLng < -180 || input.baseLng > 180) {
    throw Errors.validation("Координаты базы вне допустимого диапазона");
  }
  if (input.workdayMinutes <= 0 || input.avgSpeedKmh <= 0 || input.detourPercent <= 0) {
    throw Errors.validation("Рабочий день, скорость и петляние должны быть больше нуля");
  }
  return prisma.capacitySettings.upsert({
    where: { id: "singleton" },
    update: input,
    create: { id: "singleton", ...input },
  });
}

export function listTrafficWindows() {
  return prisma.trafficWindow.findMany({ orderBy: { fromMinutes: "asc" } });
}

export type TrafficWindowInput = { fromMinutes: number; toMinutes: number; factorPercent: number };

// Полностью заменяет набор окон (delete + create в транзакции). На окна нет внешних ссылок.
export async function replaceTrafficWindows(windows: TrafficWindowInput[]) {
  for (const w of windows) {
    if (
      !Number.isFinite(w.fromMinutes) ||
      !Number.isFinite(w.toMinutes) ||
      !Number.isFinite(w.factorPercent) ||
      w.fromMinutes < 0 ||
      w.toMinutes > 1440 ||
      w.fromMinutes >= w.toMinutes ||
      w.factorPercent <= 0
    ) {
      throw Errors.validation("Некорректное окно пробок (минуты 0–1440, from < to, коэффициент > 0)");
    }
  }
  return prisma.$transaction(async (tx) => {
    await tx.trafficWindow.deleteMany({});
    if (windows.length > 0) {
      await tx.trafficWindow.createMany({
        data: windows.map((w, i) => ({ ...w, sortOrder: i + 1 })),
      });
    }
    return tx.trafficWindow.findMany({ orderBy: { fromMinutes: "asc" } });
  });
}

// ───────────────────────── Календарь загрузки (этап 17, PRD §14.4) ─────────────────────────

export type WorkloadCell = { minutes: number; count: number };
export type WorkloadCalendar = {
  workdayMinutes: number;
  days: string[]; // YYYY-MM-DD по возрастанию
  drivers: { id: string; name: string; specialization: DriverSpecialization }[];
  cells: Record<string, Record<string, WorkloadCell>>; // [driverId][dateKey] → загрузка
  absences: Record<string, AbsenceView[]>; // [driverId] → отпуска/больничные, пересекающие период (№9)
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parseDayKey(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Сводка загрузки по (водитель, день) за период [from, to] (включительно). Сумма оценок задач
// (estimatedMinutes; если нет — норма типа) и число задач. Включаются все назначенные задачи кроме
// отменённых (CANCELLED). Водители — активные, включая внешнего перевозчика (Султан). Только Д/А.
export async function buildWorkloadCalendar(fromKey: string, toKey: string): Promise<WorkloadCalendar> {
  const from = parseDayKey(fromKey);
  const to = parseDayKey(toKey);
  if (!from || !to || from > to) throw Errors.validation("Некорректный период календаря");
  const days: string[] = [];
  for (const cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
    days.push(dayKey(cur));
    if (days.length > 31) throw Errors.validation("Слишком длинный период (макс. 31 день)");
  }

  const [settings, drivers, tasks, absences] = await Promise.all([
    getCapacitySettings(),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      select: { id: true, name: true, specialization: true },
      orderBy: { name: "asc" },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: { not: null },
        status: { not: "CANCELLED" },
        scheduledDate: { gte: from, lte: to },
      },
      select: {
        assigneeId: true,
        scheduledDate: true,
        estimatedMinutes: true,
        type: { select: { onSiteMinutes: true } },
      },
    }),
    listAbsencesInRange(fromKey, toKey),
  ]);

  // Инициализируем полную сетку нулями, чтобы у клиента не было дыр.
  const cells: Record<string, Record<string, WorkloadCell>> = {};
  for (const d of drivers) {
    cells[d.id] = {};
    for (const day of days) cells[d.id][day] = { minutes: 0, count: 0 };
  }

  for (const t of tasks) {
    if (!t.assigneeId || !t.scheduledDate) continue;
    const col = cells[t.assigneeId];
    if (!col) continue; // задача на неактивного/несписочного исполнителя — пропускаем
    const key = dayKey(t.scheduledDate);
    const cell = col[key];
    if (!cell) continue;
    cell.minutes += t.estimatedMinutes ?? t.type.onSiteMinutes ?? 0;
    cell.count += 1;
  }

  // Отпуска/больничные по водителям (№9) — для затенения дней в календаре. Только списочные водители.
  const absencesByDriver: Record<string, AbsenceView[]> = {};
  for (const d of drivers) absencesByDriver[d.id] = [];
  for (const a of absences) {
    if (absencesByDriver[a.driverId]) absencesByDriver[a.driverId].push(a);
  }

  return { workdayMinutes: settings.workdayMinutes, days, drivers, cells, absences: absencesByDriver };
}

export function listDriversWithSpecialization() {
  return prisma.user.findMany({
    where: { role: "DRIVER" },
    select: { id: true, name: true, login: true, specialization: true, isActive: true },
    orderBy: { name: "asc" },
  });
}

// Обновляет специализацию по карте {driverId: spec}. updateMany c фильтром role=DRIVER —
// чужие/не-водительские id молча игнорируются (не трогаем не-водителей).
export async function setDriverSpecializations(
  map: Record<string, DriverSpecialization>,
): Promise<void> {
  for (const [driverId, specialization] of Object.entries(map)) {
    await prisma.user.updateMany({
      where: { id: driverId, role: "DRIVER" },
      data: { specialization },
    });
  }
}
