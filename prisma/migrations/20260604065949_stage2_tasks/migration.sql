-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NEW', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'DONE', 'ON_HOLD', 'RESCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('NOT_NEEDED', 'NEEDED', 'ORDERED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('NONE', 'OFFICE', 'ON_SITE');

-- CreateTable
CREATE TABLE "TaskType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- Сквозная нумерация задач: отдельная последовательность со стартом 476
-- (решение Артёма 04.06.2026, предв. — сверить с чатом перед прод-запуском, Этап 7).
-- Должна существовать до CREATE TABLE "Task" (на неё ссылается DEFAULT колонки number).
CREATE SEQUENCE "task_number_seq" START 476;

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT nextval('task_number_seq'::regclass),
    "typeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "equipment" TEXT,
    "orgName" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "address" TEXT NOT NULL,
    "addressLink" TEXT,
    "invoiceNumber" TEXT,
    "paymentType" "PaymentType" NOT NULL DEFAULT 'NONE',
    "paymentAmount" INTEGER,
    "paymentNote" TEXT,
    "scheduledDate" DATE,
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "timeNote" TEXT,
    "passStatus" "PassStatus" NOT NULL DEFAULT 'NOT_NEEDED',
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaskStatus" NOT NULL DEFAULT 'NEW',
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelReason" TEXT,
    "holdReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- Привязываем последовательность к колонке: удалится вместе с таблицей.
ALTER SEQUENCE "task_number_seq" OWNED BY "Task"."number";

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus",
    "comment" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_name_key" ON "TaskType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Task_number_key" ON "Task"("number");

-- CreateIndex
CREATE INDEX "Task_assigneeId_scheduledDate_idx" ON "Task"("assigneeId", "scheduledDate");

-- CreateIndex
CREATE INDEX "Task_status_scheduledDate_idx" ON "Task"("status", "scheduledDate");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_at_idx" ON "TaskEvent"("taskId", "at");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TaskType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
