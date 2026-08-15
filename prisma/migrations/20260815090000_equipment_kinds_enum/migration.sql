-- Новые виды оборудования (решения Артёма 15.08.2026): раздел «Фальцепрокатники» с его составом.
--
-- ОТДЕЛЬНАЯ миграция только ради ALTER TYPE — те же грабли, что с Role.SERVICE_MANAGER и
-- TaskStatus.IN_PROGRESS: Postgres не даёт использовать новое значение enum в той же транзакции,
-- в которой оно добавлено, а `migrate deploy` выполняет каждую миграцию одной транзакцией.
-- Значения здесь только объявляются; используются начиная со следующей миграции.
--
-- Написано вручную (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "machine_number_seq"/"task_number_seq"
-- — он снёс бы сквозную нумерацию станков и заявок на проде.

-- AlterEnum
ALTER TYPE "EquipmentKind" ADD VALUE 'SEAMER';
ALTER TYPE "EquipmentKind" ADD VALUE 'UNCOILER';
ALTER TYPE "EquipmentKind" ADD VALUE 'INVERTER';
