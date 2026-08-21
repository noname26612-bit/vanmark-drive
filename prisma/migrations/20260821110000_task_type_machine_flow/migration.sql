-- Автоматика по станку при завершении заявки (этап 2 модуля оборудования, 21.08.2026, PRD §16.1).
-- Колонка на TaskType, а не матчинг по названию: название типа правит админ в /admin/task-types,
-- и автоматика, привязанная к строке, молча отвалилась бы после переименования.
--
-- CREATE TYPE (в отличие от ALTER TYPE ... ADD VALUE) можно использовать в той же транзакции,
-- поэтому объявление enum и бэкфилл живут в одной миграции.
--
-- Написано вручную (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "machine_number_seq"/"task_number_seq".

-- CreateEnum
CREATE TYPE "MachineFlow" AS ENUM ('NONE', 'SOLD_DELIVERY', 'RENTAL', 'REPAIR_RETURN', 'PURCHASE', 'CARRIER');

-- AlterTable
ALTER TABLE "TaskType" ADD COLUMN "machineFlow" "MachineFlow" NOT NULL DEFAULT 'NONE';

-- Бэкфилл по СЕГОДНЯШНИМ названиям типов (prisma/seed.ts). Разовая операция: дальше значение
-- живёт в колонке, и переименование типа автоматику не ломает. Типы, которых на этой базе нет,
-- просто не обновятся — остаются на безопасном NONE.
UPDATE "TaskType" SET "machineFlow" = 'SOLD_DELIVERY' WHERE "name" = 'Доставка проданного об.';
UPDATE "TaskType" SET "machineFlow" = 'RENTAL'        WHERE "name" = 'Доставка / забор из аренды';
UPDATE "TaskType" SET "machineFlow" = 'REPAIR_RETURN' WHERE "name" = 'Доставка / забор из ремонта';
UPDATE "TaskType" SET "machineFlow" = 'PURCHASE'      WHERE "name" = 'Закупка/выкуп станка';
UPDATE "TaskType" SET "machineFlow" = 'CARRIER'       WHERE "name" = 'Сдача / забор из ТК';
-- «Выездной ремонт / диагностика», «Гарантийный ремонт», «Прочее» и служебный тип задач
-- сотрудникам остаются NONE: станка в них не возят.
