-- Модуль «Станки»: картотека б/у оборудования (ARCHITECTURE §4г, PRD §16, ROADMAP «Модуль Станки»).
-- Решения Артёма 05.08.2026. Аддитивно: существующие таблицы НЕ меняются.
--
-- ВНИМАНИЕ (грабли проекта, см. MEMORY «Prisma migrate dev ломает task_number_seq»):
-- `prisma migrate diff` сгенерил паразитный блок
--     ALTER TABLE "Task" ... DROP SEQUENCE "task_number_seq";
-- — он снёс бы сквозную нумерацию заявок на проде. Блок УДАЛЁН вручную, нумерацию задач не трогаем.
-- Миграция применяется через `prisma migrate deploy` (не `migrate dev`).
--
-- Роль SERVICE_MANAGER добавлена ОТДЕЛЬНОЙ предыдущей миграцией (ALTER TYPE ... ADD VALUE):
-- Postgres не даёт использовать новое значение enum в транзакции, где оно создано.

-- CreateEnum
CREATE TYPE "MachineCategory" AS ENUM ('CLIENT', 'OUR_SALE', 'OUR_RENTAL');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('ACCEPTED', 'NEEDS_REPAIR', 'IN_REPAIR', 'READY', 'RENTED', 'RELEASED', 'SOLD', 'VOIDED');

-- Сквозной учётный номер ВСЕХ станков (включая клиентские) — решение Артёма 05.08.2026:
-- этот номер пишут маркером на каждый станок. Отдельная последовательность, старт с 1.
-- Должна существовать до CREATE TABLE "Machine" (на неё ссылается DEFAULT колонки number).
CREATE SEQUENCE "machine_number_seq" START 1;

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT nextval('machine_number_seq'::regclass),
    "ourNumber" INTEGER,
    "category" "MachineCategory" NOT NULL,
    "status" "MachineStatus" NOT NULL DEFAULT 'ACCEPTED',
    "model" TEXT NOT NULL,
    "configuration" TEXT,
    "metalThickness" TEXT,
    "serialNumber" TEXT,
    "orgName" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "invoice1C" TEXT,
    "responsibleId" TEXT,
    "deliveredBy" TEXT,
    "arrivedAt" DATE,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "defectNotes" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "voidReason" TEXT,
    "diagnosedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- Привязываем последовательность к колонке (как у task_number_seq).
ALTER SEQUENCE "machine_number_seq" OWNED BY "Machine"."number";


-- CreateTable
CREATE TABLE "MachineEvent" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" "MachineStatus",
    "toStatus" "MachineStatus",
    "comment" TEXT,
    "changes" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineAttachment" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Machine_number_key" ON "Machine"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_ourNumber_key" ON "Machine"("ourNumber");

-- CreateIndex
CREATE INDEX "Machine_category_status_idx" ON "Machine"("category", "status");

-- CreateIndex
CREATE INDEX "Machine_status_idx" ON "Machine"("status");

-- CreateIndex
CREATE INDEX "Machine_updatedAt_idx" ON "Machine"("updatedAt");

-- CreateIndex
CREATE INDEX "MachineEvent_machineId_at_idx" ON "MachineEvent"("machineId", "at");

-- CreateIndex
CREATE INDEX "MachineAttachment_machineId_createdAt_idx" ON "MachineAttachment"("machineId", "createdAt");

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineAttachment" ADD CONSTRAINT "MachineAttachment_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

