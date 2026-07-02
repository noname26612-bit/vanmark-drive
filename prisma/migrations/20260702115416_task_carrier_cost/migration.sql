-- Стоимость поездки внешнего перевозчика, ₽ (этап 3, решение Артёма 02.07). Аддитивно.
-- Паразитные ALTER/DROP SEQUENCE task_number_seq из генератора удалены вручную.
ALTER TABLE "Task" ADD COLUMN "carrierCost" INTEGER;
