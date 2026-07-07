-- Ручная коррекция авто-простоя смены (решение Артёма 07.07). Полоса «В работе / Простой» на доске и
-- в Сводке считается автоматически (простой = длина смены − время задач «В работе»); диспетчер может
-- задать фактический простой вручную, если водитель работал, но не взял задачу в работу (сел телефон).
-- Все поля аддитивные (nullable) — существующие смены не затрагиваются, null = авто-расчёт как прежде.
ALTER TABLE "Shift" ADD COLUMN "idleMinutesOverride" INTEGER;
ALTER TABLE "Shift" ADD COLUMN "idleOverrideById" TEXT;
ALTER TABLE "Shift" ADD COLUMN "idleOverrideAt" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "idleOverrideNote" TEXT;
