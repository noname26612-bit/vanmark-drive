// Расписание фоновых рассылок — ОДНА таблица для планировщика и для экрана «Управление».
//
// Модуль намеренно чистый: `cron.ts` при импорте регистрирует задачи (побочный эффект), поэтому
// страница, которой нужно всего лишь показать «во сколько уходит пуш», импортировать его не может —
// иначе рендер админки заводил бы планировщик.
export type CronJobId =
  | "morning-reminder"
  | "birthday-reminder"
  | "pass-warning"
  | "act-deadline"
  | "close-shift-reminder"
  | "kpi-detector"
  | "processed-cleanup";

export type CronJob = {
  id: CronJobId;
  /** Выражение node-cron. */
  expr: string;
  /** Время человеческим текстом — то, что видно в «Управлении». */
  time: string;
  /** Что происходит и кому это уходит. */
  label: string;
};

/** Часовой пояс расписания: МСК, если не переопределён окружением. */
export const CRON_TZ = process.env.CRON_TZ ?? "Europe/Moscow";

export const CRON_JOBS: readonly CronJob[] = [
  { id: "morning-reminder", expr: "0 8 * * *", time: "08:00", label: "Утренний список задач водителям" },
  { id: "birthday-reminder", expr: "0 9 * * *", time: "09:00", label: "Дни рождения коллег — всем со входом" },
  { id: "pass-warning", expr: "0 16 * * *", time: "16:00", label: "Напоминание диспетчеру о пропусках на завтра" },
  { id: "act-deadline", expr: "5 20 * * *", time: "20:05", label: "Акты к дедлайну 20:00 — отметки и пуш диспетчеру" },
  { id: "close-shift-reminder", expr: "0 21 * * *", time: "21:00", label: "«Закройте смену» водителям с открытой сменой" },
  { id: "kpi-detector", expr: "30 23 * * *", time: "23:30", label: "Кандидаты в нарушения KPI за день" },
  { id: "processed-cleanup", expr: "0 4 * * *", time: "04:00", label: "Чистка реестра идемпотентности (старше 60 дней)" },
] as const;
