-- Внешний (наёмный) исполнитель: надёжный признак вместо «canLogin=false» (решение Артёма 02.07).
-- Аддитивно + бэкфилл существующего перевозчика (login=sultan). Паразитные ALTER/DROP SEQUENCE
-- task_number_seq из генератора удалены вручную (см. память prisma-migrate-drops-task-number-seq).
ALTER TABLE "User" ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;

-- Бэкфилл: действующий внешний перевозчик. canLogin НЕ трогаем — вход включает админ осознанно.
UPDATE "User" SET "isExternal" = true WHERE "login" = 'sultan';
