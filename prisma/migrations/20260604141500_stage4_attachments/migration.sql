-- Этап 4: вложения (фото-отчёты). Только добавление: enum AttachmentKind + таблица Attachment.
-- ВНИМАНИЕ: `prisma migrate dev` для этой схемы генерит лишний DROP SEQUENCE "task_number_seq"
-- (кастомная sequence нумерации из этапа 2 не «принадлежит» Prisma). Этот блок вычищен вручную —
-- последовательность номеров задач не трогаем. Для будущих миграций: migrate dev --create-only
-- и убрать блок про task_number_seq перед применением.

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PHOTO', 'DOCUMENT');

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'PHOTO',
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_taskId_createdAt_idx" ON "Attachment"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
