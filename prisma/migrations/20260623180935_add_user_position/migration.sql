-- Аддитивная миграция (этап A, доработка №4): должность для отображения в шапке (напр. «Директор»
-- у Михаила при role=ADMIN). Не право — права определяет role. null → подпись по роли.
-- Лишний DROP SEQUENCE task_number_seq, который генерит Prisma, удалён вручную (ломает нумерацию задач).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "position" TEXT;
