-- Напарник на задаче (решение Артёма 20.07.2026, PRD §4): второй водитель парного выезда.
-- Строго аддитивно: nullable колонка + индекс + FK, существующие задачи не затрагиваются.
-- Инвариант «напарник только при назначенном ответственном и != ему» держит домен (co-driver.ts).
-- NB: паразитный DROP SEQUENCE task_number_seq (артефакт prisma migrate dev) здесь отсутствует —
-- файл написан вручную по конвенции проекта (см. 20260604141500_stage4_attachments).
ALTER TABLE "Task" ADD COLUMN "coDriverId" TEXT;
CREATE INDEX "Task_coDriverId_scheduledDate_idx" ON "Task"("coDriverId", "scheduledDate");
ALTER TABLE "Task" ADD CONSTRAINT "Task_coDriverId_fkey" FOREIGN KEY ("coDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
