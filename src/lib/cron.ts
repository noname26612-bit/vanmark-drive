// Планировщик node-cron в процессе приложения (ARCHITECTURE §8). Запускается из
// src/instrumentation.ts (register) только в Node-рантайме. Один процесс на проде — иначе
// задачи задвоятся (deploy-release: не запускать в кластере/нескольких репликах).
//
// САМО РАСПИСАНИЕ живёт в чистом `cron-schedule.ts`: его же показывает экран «Управление», а
// импортировать этот модуль со страницы нельзя — он регистрирует задачи прямо при импорте.
import cron from "node-cron";
import {
  runMorningReminders,
  runPassWarnings,
  runCloseShiftReminders,
  runBirthdayReminders,
} from "@/domain/push-service";
import { runKpiDetection, runActDeadlineDetection } from "@/domain/kpi-service";
import { cleanupProcessedActions } from "@/domain/idempotency";
import { CRON_JOBS, CRON_TZ, type CronJobId } from "./cron-schedule";

const g = globalThis as typeof globalThis & { __vanmarkCronStarted?: boolean };

// Что именно запускает каждая строка расписания. Record по id: добавили задачу в таблицу и забыли
// исполнителя — упадёт типизация здесь, а не тишина в проде.
const RUNNERS: Record<CronJobId, () => Promise<void>> = {
  "morning-reminder": runMorningReminders,
  "birthday-reminder": runBirthdayReminders,
  "pass-warning": runPassWarnings,
  "act-deadline": runActDeadlineDetection,
  "close-shift-reminder": runCloseShiftReminders,
  "kpi-detector": runKpiDetection,
  "processed-cleanup": async () => {
    await cleanupProcessedActions(60); // чистим реестр идемпотентности старше 60 дней (O11)
  },
};

function schedule(name: string, expr: string, job: () => Promise<void>): void {
  if (cron.getTasks().has(name)) return; // защита от повторной регистрации (register может вызваться >1 раза)
  cron.schedule(
    expr,
    async () => {
      try {
        await job();
      } catch (e) {
        console.error(`[cron] ${name} failed`, e);
      }
    },
    { name, timezone: CRON_TZ, noOverlap: true },
  );
}

if (!g.__vanmarkCronStarted) {
  g.__vanmarkCronStarted = true;
  for (const job of CRON_JOBS) schedule(job.id, job.expr, RUNNERS[job.id]);
  console.log(`[cron] scheduled ${CRON_JOBS.map((j) => j.time).join(" + ")} (${CRON_TZ})`);
}

export {};
