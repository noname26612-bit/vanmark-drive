-- Акты до 20:00: причина, выбранная водителем при завершении актовой задачи без акта.
-- Аддитивно. Паразитные ALTER/DROP SEQUENCE task_number_seq из генератора удалены вручную
-- (drift общей dev-БД; см. CLAUDE.md / память prisma-migrate-drops-task-number-seq).
ALTER TABLE "Task" ADD COLUMN "actMissedReason" TEXT;
