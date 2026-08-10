-- Станки: срок готовности/выдачи (dueDate) + вид оборудования (kind: станок / роликовый нож).
-- Решения Артёма 07.08.2026 (ARCHITECTURE §4г, PRD §16). Аддитивно: только новый тип и две
-- колонки, существующие строки получают kind='MACHINE' и dueDate=NULL — бэкфилл не нужен.
--
-- ВНИМАНИЕ (грабли проекта, см. MEMORY «Prisma migrate dev ломает task_number_seq»):
-- `prisma migrate diff` сгенерил паразитные блоки
--     ALTER TABLE "Machine" ... DROP SEQUENCE "machine_number_seq";
--     ALTER TABLE "Task"    ... DROP SEQUENCE "task_number_seq";
-- — они снесли бы сквозную нумерацию станков И заявок на проде. Оба блока УДАЛЕНЫ вручную.
-- Миграция применяется через `prisma migrate deploy` (не `migrate dev`).
--
-- EquipmentKind создаётся целиком (CREATE TYPE, не ALTER TYPE ADD VALUE), поэтому использование
-- значения в этой же транзакции легально — одна миграция, в отличие от кейса SERVICE_MANAGER.

-- CreateEnum
CREATE TYPE "EquipmentKind" AS ENUM ('MACHINE', 'ROLLER_KNIFE');

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN "kind" "EquipmentKind" NOT NULL DEFAULT 'MACHINE';
ALTER TABLE "Machine" ADD COLUMN "dueDate" DATE;
