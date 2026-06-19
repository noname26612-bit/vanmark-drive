-- Настройки интерфейса пользователя: персональная раскладка экранов диспетчера (порядок пулов и
-- свёрнутые пулы на доске «Сегодня», порядок строк-пулов на «Планировании»). Аддитивно, без правок
-- существующих таблиц. Написано вручную (migrate deploy), чтобы не сбрасывать общую dev-БД —
-- см. память проекта prisma-migrate-drops-task-number-seq.

-- CreateTable
CREATE TABLE "UiPreference" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UiPreference_pkey" PRIMARY KEY ("userId","key")
);

-- AddForeignKey
ALTER TABLE "UiPreference" ADD CONSTRAINT "UiPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
