-- Пометки диспетчера о простое водителя (решение Артёма 02.07). Аддитивно: новая таблица.
-- Паразитные ALTER/DROP SEQUENCE task_number_seq из генератора удалены вручную.
-- CreateTable
CREATE TABLE "DriverIdleNote" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "kpiMarkId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverIdleNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverIdleNote_kpiMarkId_key" ON "DriverIdleNote"("kpiMarkId");

-- CreateIndex
CREATE INDEX "DriverIdleNote_date_idx" ON "DriverIdleNote"("date");

-- CreateIndex
CREATE INDEX "DriverIdleNote_driverId_date_idx" ON "DriverIdleNote"("driverId", "date");

-- AddForeignKey
ALTER TABLE "DriverIdleNote" ADD CONSTRAINT "DriverIdleNote_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
