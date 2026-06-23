-- Аддитивная миграция (этап D, доработка №8): факт оплаты при завершении ON_SITE-задачи.
-- Завершить можно без оплаты — тогда paymentReceived=false и причина в paymentMissedReason
-- (информация для диспетчера, без штрафа KPI — решение Артёма 23.06). Создана вручную (drift dev-БД).

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "paymentReceived" BOOLEAN,
ADD COLUMN     "paymentMissedReason" TEXT;
