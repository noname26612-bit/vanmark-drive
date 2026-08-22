// Ядро экрана «Управление» (22.08.2026) — чистые функции без БД: что показать в блоке «Требует
// внимания» и в каком порядке. Доступ к данным — в admin-overview-service.ts.
//
// ПРАВИЛО БЛОКА: плашка появляется, только когда есть что делать. Ряд из нулей приучает не смотреть
// на этот блок вовсе — а он ровно для того, чтобы утром за десять секунд увидеть, где стоит работа.
//
// ЦВЕТ = СМЫСЛ (ui-guidelines): красный ТОЛЬКО «сорвано» (просроченная заявка — клиент ждал
// вчера), янтарный — «требует действия сейчас». Больше цветов в блоке нет.

/** Что показывает одна плашка «Требует внимания». */
export type AttentionTile = {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "red" | "amber";
  /** Пояснение под числом: почему это здесь и что с этим делать. */
  hint?: string;
};

/** Числа, из которых собирается блок. Каждое поле — уже посчитанный сервисом счётчик. */
export type AttentionInput = {
  staleShifts: number; // незакрытые смены прошлых дней
  overdue: number; // просроченные заявки
  tomorrowPasses: number; // не заказанные пропуска на завтра
  kpiCandidates: number; // кандидаты в нарушения KPI, ждут решения
  /** Прошлый месяц KPI не закрыт — и есть кого считать (иначе плашка горела бы вечно). */
  prevPeriodOpen: { period: string } | null;
  machinesDuePressing: number; // листогибы: срок горит или просрочен
  machinesUrgent: number; // листогибы: срочные
  seamersDuePressing: number;
  seamersUrgent: number;
  birthdaysSoon: number; // дни рождения в ближайшую неделю
  absencesNow: number; // сейчас в отпуске/на больничном
};

/**
 * Плашки блока в порядке «сначала то, что горит»: смены и заявки (сегодняшняя работа) → расчёт →
 * оборудование → люди. Пустые плашки не возвращаются вовсе.
 */
export function buildAttentionTiles(input: AttentionInput): AttentionTile[] {
  const tiles: AttentionTile[] = [
    {
      key: "stale-shifts",
      label: "Незакрытые смены",
      count: input.staleShifts,
      href: "/board",
      tone: "amber",
      hint: "Смена прошлого дня осталась открытой — закройте её",
    },
    {
      key: "overdue",
      label: "Просроченные заявки",
      count: input.overdue,
      href: "/board#attention",
      tone: "red", // единственный красный: клиент ждал, а к нему не приехали
      hint: "Дата прошла, а заявка не завершена",
    },
    {
      key: "tomorrow-passes",
      label: "Пропуска на завтра",
      count: input.tomorrowPasses,
      href: "/board#attention",
      tone: "amber",
      hint: "Пропуск ещё не заказан",
    },
    {
      key: "kpi-candidates",
      label: "Отметки KPI на разбор",
      count: input.kpiCandidates,
      href: "/kpi",
      tone: "amber",
      hint: "Кандидаты в нарушения ждут решения",
    },
    {
      key: "machines-due",
      label: "Листогибы: горит срок",
      count: input.machinesDuePressing,
      href: "/machines?flag=duePressing",
      tone: "amber",
    },
    {
      key: "machines-urgent",
      label: "Листогибы: срочные",
      count: input.machinesUrgent,
      href: "/machines?flag=urgent",
      tone: "amber",
    },
    {
      key: "seamers-due",
      label: "Фальцепрокатники: горит срок",
      count: input.seamersDuePressing,
      href: "/seamers?flag=duePressing",
      tone: "amber",
    },
    {
      key: "seamers-urgent",
      label: "Фальцепрокатники: срочные",
      count: input.seamersUrgent,
      href: "/seamers?flag=urgent",
      tone: "amber",
    },
    {
      key: "birthdays",
      label: "Дни рождения на неделе",
      count: input.birthdaysSoon,
      href: "/team",
      tone: "amber",
    },
    {
      key: "absences",
      label: "Сейчас отсутствуют",
      count: input.absencesNow,
      href: "/team",
      tone: "amber",
      hint: "Отпуск или больничный идёт прямо сейчас",
    },
  ];

  // Незакрытый расчётный месяц — не счётчик, а факт: показываем плашкой с «1», но только когда
  // месяц действительно ждёт закрытия (есть активные денежные профили — иначе считать некого).
  const withPeriod = input.prevPeriodOpen
    ? [
        ...tiles.slice(0, 4),
        {
          key: "period-open",
          label: `Расчёт за ${input.prevPeriodOpen.period} не закрыт`,
          count: 1,
          href: `/kpi?period=${input.prevPeriodOpen.period}`,
          tone: "amber" as const,
          hint: "Прошлый месяц ещё не зафиксирован",
        },
        ...tiles.slice(4),
      ]
    : tiles;

  return withPeriod.filter((t) => t.count > 0);
}

/** Предыдущий расчётный месяц: «2026-08» → «2026-07». */
export function prevPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m-1 — текущий месяц, ещё −1 — предыдущий
  return d.toISOString().slice(0, 7);
}

/** Дни рождения в ближайшие `days` суток включительно (0 — сегодня). */
export function soonBirthdays<T extends { inDays: number }>(list: T[], days: number): T[] {
  return list.filter((b) => b.inDays >= 0 && b.inDays <= days);
}

/** Отсутствия, идущие ПРЯМО СЕЙЧАС (запланированные на будущее сюда не попадают). */
export function currentAbsences<T extends { dateFrom: string; dateTo: string }>(
  list: T[],
  todayKey: string,
): T[] {
  return list.filter((a) => a.dateFrom <= todayKey && a.dateTo >= todayKey);
}
