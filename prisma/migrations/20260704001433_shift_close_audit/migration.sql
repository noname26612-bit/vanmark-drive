-- Аудит закрытия смены диспетчером/директором/админом (№2) и правки времени закрытия (№3).
-- Все поля аддитивные (nullable) — существующие смены не затрагиваются, данные не теряются.
ALTER TABLE "Shift" ADD COLUMN "closedById" TEXT;
ALTER TABLE "Shift" ADD COLUMN "closedAtReported" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "closedAtAdjustedById" TEXT;
ALTER TABLE "Shift" ADD COLUMN "closedAtAdjustedAt" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "closedAtAdjustNote" TEXT;
