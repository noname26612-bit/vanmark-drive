-- CreateEnum
CREATE TYPE "WorksheetStatus" AS ENUM ('DRAFT', 'PRICING', 'PRICED', 'SIGNED');

-- AlterTable: состояние ведомости на задаче (null — ведомость не нужна для этого типа)
ALTER TABLE "Task" ADD COLUMN     "worksheetStatus" "WorksheetStatus";

-- AlterTable
ALTER TABLE "TaskType" ADD COLUMN     "requiresPricing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WorkCatalogItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkCatalogItem_name_key" ON "WorkCatalogItem"("name");

-- CreateIndex
CREATE INDEX "WorkItem_taskId_sortOrder_idx" ON "WorkItem"("taskId", "sortOrder");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "WorkCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: расценка/ведомость нужны выездному ремонту и гарантии (PRD §3, §13). Сид проставит то же
-- для свежей БД; здесь — для уже существующих типов, чтобы не плодить рассинхрон.
UPDATE "TaskType" SET "requiresPricing" = true WHERE "name" IN ('Выездной ремонт / диагностика', 'Гарантийный ремонт');
