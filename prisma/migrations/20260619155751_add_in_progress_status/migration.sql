-- Этап A: новый статус «В работе». Объединяет прежние ACCEPTED/EN_ROUTE/ON_SITE (схлопывание цепочки).
-- Только ADD VALUE: использовать новое значение (UPDATE задач) в этой же транзакции нельзя —
-- перенос данных вынесен в отдельную миграцию collapse_task_statuses.
-- Лишний DROP SEQUENCE task_number_seq, который генерит Prisma, удалён вручную (ломает нумерацию).
-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'IN_PROGRESS' AFTER 'ASSIGNED';
