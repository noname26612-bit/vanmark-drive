-- Скрытые подсказки моделей (решение Артёма 20.08.2026): «нужно добавить сбоку возможность удалить
-- подсказку по моделям — туда иногда заносят временное название».
--
-- Пул подсказок комбобокса = справочник-константа + реально введённые названия из карточек
-- (src/domain/machine-models.ts). Поэтому «Хз ждём Михаила», введённое один раз, потом предлагается
-- всем и навсегда. Крестик в списке кладёт имя сюда — и подсказка перестаёт показываться.
-- Карточки со старым названием при этом не меняются: это подавление подсказки, а не правка данных.
--
-- Написано вручную (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "machine_number_seq"/"task_number_seq".

-- CreateTable
CREATE TABLE "MachineModelSuppression" (
    "id" TEXT NOT NULL,
    "family" "EquipmentFamily" NOT NULL,
    "nameLower" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineModelSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: одно и то же название прячется отдельно в каждом разделе — у листогибов и
-- фальцепрокатников свои справочники моделей.
CREATE UNIQUE INDEX "MachineModelSuppression_family_nameLower_key" ON "MachineModelSuppression"("family", "nameLower");
