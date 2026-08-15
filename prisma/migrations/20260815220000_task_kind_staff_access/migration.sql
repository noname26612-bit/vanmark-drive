-- Два контура задач (решение Артёма 15.08.2026): заявки водителям (DELIVERY) и задачи сотрудникам
-- (STAFF — цех и снабжение: Александр, Николай, позже цеховые).
--
-- Написано вручную (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "task_number_seq"/"machine_number_seq"
-- — он снёс бы сквозную нумерацию заявок и станков. Нумерацию НЕ ТРОГАЕМ.
--
-- Миграция аддитивная: всё уже заведённое остаётся DELIVERY по DEFAULT, поведение не меняется.

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('DELIVERY', 'STAFF');

-- AlterTable: контур на задаче (снимок с типа) и на самом типе
ALTER TABLE "Task" ADD COLUMN "kind" "TaskKind" NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "TaskType" ADD COLUMN "kind" "TaskKind" NOT NULL DEFAULT 'DELIVERY';

-- AlterTable: персональный допуск к задачам сотрудникам (как equipmentAccess — не роль, а флаг)
ALTER TABLE "User" ADD COLUMN "staffTasksAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: выборки доски и «Всех задач» всегда идут внутри одного контура
CREATE INDEX "Task_kind_scheduledDate_idx" ON "Task"("kind", "scheduledDate");
