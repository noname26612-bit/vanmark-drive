-- Этап 15: бонус за комплектность актов (PRD §12.6). Аддитивно, существующие данные не трогаем.
-- (Паразитный блок Prisma про Task.number / DROP SEQUENCE task_number_seq удалён вручную —
--  см. память проекта prisma-migrate-drops-task-number-seq.)

-- AlterTable
ALTER TABLE "KpiSettings" ADD COLUMN     "actBonusAmount" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "actBonusThresholdPercent" INTEGER NOT NULL DEFAULT 80;

-- AlterTable
ALTER TABLE "PayrollStatement" ADD COLUMN     "actBase" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "actBonus" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "actComplete" INTEGER NOT NULL DEFAULT 0;
