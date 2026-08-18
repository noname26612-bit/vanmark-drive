-- День рождения сотрудника (вкладка «Команда», PRD §18, 18.08.2026).
-- Опционально (у кого не спросили — NULL). Календарная дата без времени, как DriverAbsence.dateFrom;
-- год хранится, но интерфейс и пуши показывают дату без года.
-- Написано вручную: migrate diff подкладывает паразитные DROP SEQUENCE (task_number_seq,
-- machine_number_seq, staff_task_number_seq) — нумерации не трогаем.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "birthday" DATE;
