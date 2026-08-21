-- Связь заявки со станком (этап 2 модуля оборудования, 21.08.2026, PRD §16.1): «везём станок на
-- продажу → подцепляем к заявке». Join-таблица, а не Task.machineId из старого эскиза PRD:
-- станков в заявке бывает несколько, и на самой связи живут направление и отметки автоматики.
--
-- Строго аддитивно: существующие таблицы не меняются, у заявок без привязок ничего не появляется.
-- FK без каскадов — станки не удаляются (аннулируются), заявки уходят в мягкий архив.
--
-- Написано вручную (не `migrate diff`): генератор подкладывает паразитный
--     DROP SEQUENCE "machine_number_seq"/"task_number_seq".

-- CreateEnum
CREATE TYPE "TaskMachineDirection" AS ENUM ('OUT', 'IN');

-- CreateTable
CREATE TABLE "TaskMachine" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "direction" "TaskMachineDirection" NOT NULL DEFAULT 'OUT',
    "appliedStatus" "MachineStatus",
    "appliedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMachine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskMachine_taskId_machineId_key" ON "TaskMachine"("taskId", "machineId");

-- CreateIndex
CREATE INDEX "TaskMachine_machineId_createdAt_idx" ON "TaskMachine"("machineId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskMachine" ADD CONSTRAINT "TaskMachine_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMachine" ADD CONSTRAINT "TaskMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
