-- Этап 11 (PRD §3–§5, §13): требование акта на уровне задачи + приведение типов к новому списку.
-- Ручная правка после `migrate --create-only`: убран паразитный DROP SEQUENCE task_number_seq,
-- который Prisma добавляет к каждой миграции из-за dbgenerated-дефолта номера (см. память проекта).

-- AlterTable: требование подписанного акта на уровне задачи (снимок из типа, изменяемо галочкой).
ALTER TABLE "Task" ADD COLUMN     "actWaivedNote" TEXT,
ADD COLUMN     "requiresSignedDoc" BOOLEAN NOT NULL DEFAULT false;

-- Data: переименование типов под новый список PRD §3. Сид upsert'ит по name, поэтому переименование
-- делаем здесь — иначе на проде появятся дубли, а существующие задачи останутся на старых типах.
UPDATE "TaskType" SET "name" = 'Доставка из ремонта', "icon" = 'package-check', "requiresSignedDoc" = false WHERE "name" = 'Доставка/возврат из ремонта';
UPDATE "TaskType" SET "name" = 'Сдача в ТК' WHERE "name" = 'Отвезти в ТК';
UPDATE "TaskType" SET "name" = 'Забрать посылку' WHERE "name" = 'Забрать СДЭК/посылку';
UPDATE "TaskType" SET "name" = 'Гарантийный ремонт', "requiresSignedDoc" = true WHERE "name" = 'Гарантийная замена';
UPDATE "TaskType" SET "name" = 'Доставка проданного оборудования' WHERE "name" = 'Доставка проданного';

-- Data: backfill требования акта на существующих задачах из их (уже обновлённого) типа,
-- чтобы старые задачи сохранили корректное требование для KPI и бонуса.
UPDATE "Task" t SET "requiresSignedDoc" = tt."requiresSignedDoc" FROM "TaskType" tt WHERE t."typeId" = tt."id";
