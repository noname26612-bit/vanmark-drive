-- Архив заявки (решение Артёма 11.08.2026): мягкое удаление дублей и ошибочных заявок.
-- Аддитивно: два nullable-поля и индекс. Статусная матрица не менялась, строки не удаляются,
-- журнал TaskEvent остаётся на месте, номер заявки не переиспользуется.
--
-- ВНИМАНИЕ (грабли проекта, ARCHITECTURE §4г): SQL написан вручную, а НЕ взят из `migrate diff` —
-- diff на этой базе выдаёт паразитные `DROP SEQUENCE "task_number_seq"` и `"machine_number_seq"`,
-- что обнулило бы сквозную нумерацию заявок и станков. Проверять глазами каждую миграцию.

ALTER TABLE "Task" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT;

-- CreateIndex
CREATE INDEX "Task_archivedAt_idx" ON "Task"("archivedAt");
