-- Этап A: перенос открытых задач со старых статусов рабочей цепочки в новый IN_PROGRESS «В работе».
-- Меняем только ТЕКУЩЕЕ состояние задач (Task.status). Неизменяемый журнал TaskEvent НЕ трогаем
-- (CLAUDE.md правило 3): прежние ACCEPTED/EN_ROUTE/ON_SITE остаются в истории как были.
-- Отдельная миграция (не вместе с ADD VALUE): новое значение enum нельзя использовать в той же
-- транзакции, где оно добавлено.
UPDATE "Task" SET "status" = 'IN_PROGRESS'
WHERE "status" IN ('ACCEPTED', 'EN_ROUTE', 'ON_SITE');
