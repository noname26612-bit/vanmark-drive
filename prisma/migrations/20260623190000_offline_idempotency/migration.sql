-- Офлайн-режим водителя: реестр идемпотентности досылки (модель ProcessedAction, schema.prisma).
-- Аддитивно — добавляем только новую таблицу, существующие не трогаем. Лишний DROP SEQUENCE
-- task_number_seq, который Prisma генерит при diff, здесь НЕ нужен (см. память проекта).

-- CreateTable
CREATE TABLE "ProcessedAction" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedAction_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ProcessedAction_userId_createdAt_idx" ON "ProcessedAction"("userId", "createdAt");
