import "server-only";
// Сборка экрана «Управление» (22.08.2026): что требует внимания прямо сейчас + состояние системы.
//
// СОБИРАЕТСЯ ИЗ УЖЕ СУЩЕСТВУЮЩИХ ИСТОЧНИКОВ — своих запросов и своей арифметики здесь нет: числа
// на «Управлении» обязаны совпадать с теми, что человек увидит, перейдя по плашке. Дублирующий
// запрос неизбежно разошёлся бы с экраном (и молча).
//
// Promise.allSettled, а не all: «Управление» — стартовый экран администратора, и падение одного
// источника (например, картотеки) не должно превращать всю страницу в ошибку. Сбойный блок честно
// подписывается «не удалось получить», остальные работают.
import { prisma } from "@/lib/prisma";
import { dateKeyInTz, KPI_TZ, periodOf } from "./kpi";
import { listStaleShifts } from "./shift-service";
import { listAttention } from "./task-service";
import { getKpiOverview, isPeriodClosed, listPayProfiles } from "./kpi-service";
import { listMachines } from "./machine-service";
import { getTeamSnapshot } from "./team-service";
import { buildAttentionTiles, currentAbsences, prevPeriod, soonBirthdays, type AttentionTile } from "./admin-overview";
import { buildVersion } from "@/lib/build-version";
import type { Role } from "./roles";

/** Горизонт «ближайших» дней рождения на «Управлении», дней. */
const BIRTHDAY_DAYS = 7;

export type AdminOverview = {
  todayKey: string;
  tiles: AttentionTile[];
  /** Источники, которые не ответили: блок честно говорит, что картина неполная. */
  failed: string[];
  system: {
    buildVersion: string;
    pushSubscriptions: number | null; // null — не удалось получить
  };
};

export async function getAdminOverview(actor: { id: string; role: Role }): Promise<AdminOverview> {
  const todayKey = dateKeyInTz(new Date(), KPI_TZ);
  const period = periodOf(new Date(), KPI_TZ);
  const prev = prevPeriod(period);

  const [staleShifts, attention, kpi, prevClosed, payProfiles, benders, seamers, team, pushSubs] =
    await Promise.allSettled([
      listStaleShifts(todayKey),
      listAttention(todayKey),
      // payrollVisible=false: на «Управлении» рублей нет, а считать их незачем — нужен только
      // список кандидатов, тот же самый, что покажет экран KPI.
      getKpiOverview(period, { payrollVisible: false }),
      isPeriodClosed(prev),
      listPayProfiles(),
      listMachines({ family: "BENDER" }, actor),
      listMachines({ family: "SEAMER" }, actor),
      getTeamSnapshot(),
      prisma.pushSubscription.count(),
    ]);

  const failed: string[] = [];
  const value = <T>(r: PromiseSettledResult<T>, label: string, fallback: T): T => {
    if (r.status === "fulfilled") return r.value;
    console.error(`[admin-overview] ${label} failed`, r.reason);
    failed.push(label);
    return fallback;
  };

  const shifts = value(staleShifts, "смены", []);
  const att = value(attention, "заявки", { overdue: [], tomorrowPasses: [] });
  const kpiOverview = value(kpi, "KPI", null);
  const closed = value(prevClosed, "расчёт", true); // не знаем — не тревожим
  const profiles = value(payProfiles, "расчёт", []);
  const bendersResult = value(benders, "листогибы", null);
  const seamersResult = value(seamers, "фальцепрокатники", null);
  const teamSnapshot = value(team, "команда", null);

  // Плашку «месяц не закрыт» показываем, только если считать ЕСТЬ КОГО: без активных денежных
  // профилей закрывать нечего, и плашка горела бы вечно.
  const hasPayroll = profiles.some((p) => p.isActive);

  const tiles = buildAttentionTiles({
    staleShifts: shifts.length,
    overdue: att.overdue.length,
    tomorrowPasses: att.tomorrowPasses.length,
    kpiCandidates: kpiOverview?.candidates.length ?? 0,
    prevPeriodOpen: !closed && hasPayroll ? { period: prev } : null,
    machinesDuePressing: bendersResult?.summary.duePressing ?? 0,
    machinesUrgent: bendersResult?.summary.urgent ?? 0,
    seamersDuePressing: seamersResult?.summary.duePressing ?? 0,
    seamersUrgent: seamersResult?.summary.urgent ?? 0,
    birthdaysSoon: teamSnapshot ? soonBirthdays(teamSnapshot.birthdays, BIRTHDAY_DAYS).length : 0,
    absencesNow: teamSnapshot ? currentAbsences(teamSnapshot.absences, todayKey).length : 0,
  });

  return {
    todayKey,
    tiles,
    failed: [...new Set(failed)],
    system: {
      buildVersion: buildVersion(),
      pushSubscriptions: pushSubs.status === "fulfilled" ? pushSubs.value : null,
    },
  };
}
