-- Разделы картотеки, складские остатки и персональный доступ (решения Артёма 15.08.2026).
--
-- Написано вручную (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "machine_number_seq"/"task_number_seq"
-- — он снёс бы сквозную нумерацию станков и заявок. Нумерацию НЕ ТРОГАЕМ: колонка Machine.number
-- и последовательность machine_number_seq остаются как есть, из интерфейса номер просто убран.
--
-- Все существующие карточки (на проде — листогибы и ножи) получают family='BENDER' по DEFAULT,
-- поэтому отдельного UPDATE для миграции данных не нужно.

-- CreateEnum
CREATE TYPE "EquipmentFamily" AS ENUM ('BENDER', 'SEAMER');

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN "family" "EquipmentFamily" NOT NULL DEFAULT 'BENDER';
ALTER TABLE "Machine" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: персональный доступ к разделам оборудования (Николай, Александр). Роль не меняется.
ALTER TABLE "User" ADD COLUMN "equipmentAccess" BOOLEAN NOT NULL DEFAULT false;

-- «77-N» уникален ВНУТРИ раздела, а не глобально: у листогибов и фальцепрокатников свои цепочки
-- номеров. NULL в уникальном индексе Postgres не конфликтует сам с собой — карточек без номера
-- по-прежнему может быть сколько угодно.
DROP INDEX "Machine_ourNumber_key";
CREATE UNIQUE INDEX "Machine_family_ourNumber_key" ON "Machine"("family", "ourNumber");

-- CreateIndex
CREATE INDEX "Machine_family_status_idx" ON "Machine"("family", "status");
