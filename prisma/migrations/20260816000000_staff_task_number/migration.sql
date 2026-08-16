-- Своя нумерация задач цеха: «Ц-1», «Ц-2», … (решение Артёма 15.08.2026, вечер).
--
-- Зачем отдельный номер: сквозной task_number_seq довёл заявки до №800+, и задача цеха получала
-- номер из того же ряда — в разговоре «восемьсот девятая» звучала как доставка. Цех считает свои
-- задачи с единицы, а приставка «Ц-» отличает их от заявок в общем поиске (как «77-N»/«К-N» у
-- станков).
--
-- Написано ВРУЧНУЮ (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "task_number_seq"/"machine_number_seq"
-- — он снёс бы сквозную нумерацию заявок и станков. Нумерацию НЕ ТРОГАЕМ.
--
-- Последовательность намеренно НЕ привязана к колонке (без DEFAULT и без OWNED BY): номер выдаёт
-- домен только задачам контура STAFF, а default на колонке жёг бы номера и на каждой доставке.

-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS "staff_task_number_seq" START 1;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "staffNumber" INTEGER;

-- CreateIndex: номер цеха уникален; NULL у доставок в unique не конфликтуют.
CREATE UNIQUE INDEX "Task_staffNumber_key" ON "Task"("staffNumber");

-- ─────────────────────────── Перенумерация уже заведённого ───────────────────────────
-- Задачи цеха, заведённые до сегодняшнего дня, получают 1, 2, 3… в порядке создания (решение
-- Артёма: на проде это несколько тестовых задач, путаницы не будет). Сквозной `number` остаётся
-- при них — по нему сходятся журналы, пуши и ссылки.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Task"
  WHERE kind = 'STAFF'
)
UPDATE "Task" t
SET "staffNumber" = r.rn
FROM ranked r
WHERE t.id = r.id;

-- Последовательность встаёт за максимумом: следующая созданная задача получает max+1.
SELECT setval(
  'staff_task_number_seq',
  COALESCE((SELECT MAX("staffNumber") FROM "Task"), 0) + 1,
  false
);
