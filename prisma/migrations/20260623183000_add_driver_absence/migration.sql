-- Аддитивная миграция (этап E, доработка №9): отсутствие водителя (отпуск/больничный/прочее).
-- Новая таблица + новый enum в одной миграции — это CREATE TYPE (не ADD VALUE к существующему),
-- безопасно в одной транзакции. Создана вручную (drift общей dev-БД); образец — add_shift.

-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('VACATION', 'SICK', 'OTHER');

-- CreateTable
CREATE TABLE "DriverAbsence" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "type" "AbsenceType" NOT NULL DEFAULT 'VACATION',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverAbsence_driverId_dateFrom_idx" ON "DriverAbsence"("driverId", "dateFrom");

-- CreateIndex
CREATE INDEX "DriverAbsence_dateFrom_dateTo_idx" ON "DriverAbsence"("dateFrom", "dateTo");

-- AddForeignKey
ALTER TABLE "DriverAbsence" ADD CONSTRAINT "DriverAbsence_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
