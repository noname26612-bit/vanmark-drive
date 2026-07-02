-- O7 (офлайн-смена): пометка «смена открыта офлайн» — openedAt зафиксирован временем телефона
-- (X-Occurred-At из очереди досылки), а не сервером. Аддитивно, без потери данных.
ALTER TABLE "Shift" ADD COLUMN "openedOffline" BOOLEAN NOT NULL DEFAULT false;
