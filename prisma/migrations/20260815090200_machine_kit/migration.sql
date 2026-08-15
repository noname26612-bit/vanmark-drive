-- Комплектация оборудования (решение Артёма 15.08.2026): нож идёт к своему листогибу, размотчик и
-- частотник — к своему фальцепрокатнику, и при продаже/аренде/ремонте они уезжают вместе.
--
-- ON DELETE CASCADE (в отличие от RESTRICT у событий и фото): связь комплекта — не журнал, её
-- удаление ничего не теряет. Карточки станков всё равно не удаляются, для ошибочных есть VOIDED.
--
-- Написано вручную (не `migrate diff`) — см. шапку соседних миграций про паразитный DROP SEQUENCE.

-- CreateTable
CREATE TABLE "MachineKitPart" (
    "id" TEXT NOT NULL,
    "headId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineKitPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MachineKitPart_headId_partId_key" ON "MachineKitPart"("headId", "partId");

-- CreateIndex
CREATE INDEX "MachineKitPart_partId_idx" ON "MachineKitPart"("partId");

-- AddForeignKey
ALTER TABLE "MachineKitPart" ADD CONSTRAINT "MachineKitPart_headId_fkey" FOREIGN KEY ("headId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineKitPart" ADD CONSTRAINT "MachineKitPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
