-- CreateEnum
CREATE TYPE "DriverSpecialization" AS ENUM ('REPAIR', 'DELIVERY', 'ANY');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "estimateIsManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;
-- NB: Prisma также сгенерировала ALTER/DROP для task_number_seq — вырезано вручную (ломает нумерацию,
-- см. MEMORY «prisma-migrate-drops-task-number-seq»). Sequence остаётся как есть.

-- AlterTable
ALTER TABLE "TaskType" ADD COLUMN     "onSiteMinutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "specialization" "DriverSpecialization" NOT NULL DEFAULT 'ANY';

-- CreateTable
CREATE TABLE "CapacitySettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "baseLat" DOUBLE PRECISION NOT NULL DEFAULT 55.959611,
    "baseLng" DOUBLE PRECISION NOT NULL DEFAULT 37.864076,
    "workdayMinutes" INTEGER NOT NULL DEFAULT 480,
    "avgSpeedKmh" INTEGER NOT NULL DEFAULT 50,
    "detourPercent" INTEGER NOT NULL DEFAULT 110,
    "countReturnTrip" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapacitySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficWindow" (
    "id" TEXT NOT NULL,
    "fromMinutes" INTEGER NOT NULL,
    "toMinutes" INTEGER NOT NULL,
    "factorPercent" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrafficWindow_pkey" PRIMARY KEY ("id")
);
