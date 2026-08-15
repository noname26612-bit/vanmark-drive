-- Две схемы учётного номера по происхождению станка (решение Артёма 15.08.2026, вечер):
-- своё железо — «77-N» (Machine.ourNumber), чужое — «К-N» (Machine.clientNumber).
--
-- Написано вручную (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "machine_number_seq"/"task_number_seq"
-- — он снёс бы сквозную нумерацию станков и заявок. Нумерацию НЕ ТРОГАЕМ.

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN "clientNumber" INTEGER;

-- CreateIndex: «К-N» уникален внутри раздела, ровно как «77-N». NULL в unique не конфликтует.
CREATE UNIQUE INDEX "Machine_family_clientNumber_key" ON "Machine"("family", "clientNumber");

-- ─────────────────────────── Перенумерация уже заведённого ───────────────────────────
-- До сегодняшнего дня «77-N» выдавался любой категории, поэтому клиентские станки стоят с номерами
-- своего парка. Номер обязан следовать за категорией, значит клиентские переезжают в «К-N».
--
-- Бэкап старых номеров — обычная таблица вне схемы Prisma: если Артём попросит вернуть маркировку,
-- восстановить будет откуда, не поднимая дамп целиком. Удалить отдельной миграцией, когда решение
-- отстоится (ориентир — месяц).
CREATE TABLE IF NOT EXISTS "machine_number_backup_20260815" AS
SELECT id, family, "ourNumber", now() AS "backedUpAt"
FROM "Machine"
WHERE category = 'CLIENT' AND "ourNumber" IS NOT NULL;

-- Живым клиентским карточкам выдаём «К-1, К-2…» по порядку: сначала те, у кого номер уже был
-- (в порядке номера — привычная людям последовательность сохраняется), затем остальные по дате
-- заведения. Аннулированные (VOIDED) номер не получают: это ошибочные карточки, им номер не нужен.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY family
           ORDER BY "ourNumber" ASC NULLS LAST, "createdAt" ASC, id ASC
         ) AS rn
  FROM "Machine"
  WHERE category = 'CLIENT' AND status <> 'VOIDED'
)
UPDATE "Machine" m
SET "clientNumber" = r.rn, "ourNumber" = NULL
FROM ranked r
WHERE m.id = r.id;

-- С аннулированных клиентских «77-N» снимаем: номер принадлежит схеме своего парка и должен
-- освободиться для живого железа.
UPDATE "Machine"
SET "ourNumber" = NULL
WHERE category = 'CLIENT' AND status = 'VOIDED' AND "ourNumber" IS NOT NULL;
