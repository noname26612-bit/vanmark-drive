-- Нормо-часы месяца для стоимости часа водителя (Сводка v2, 02.07). Аддитивно.
-- Паразитные ALTER/DROP SEQUENCE task_number_seq из генератора удалены вручную.
ALTER TABLE "KpiSettings" ADD COLUMN "monthNormHours" INTEGER NOT NULL DEFAULT 176;
