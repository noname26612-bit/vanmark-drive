import { notFound } from "next/navigation";
import { requireEquipmentUser } from "@/lib/session";
import { getMachine } from "@/domain/machine-service";
import { DomainError } from "@/domain/errors";
import { MachineCardClient } from "./machine-card-client";

export const dynamic = "force-dynamic";

// Карточка единицы оборудования. Первый рендер — серверный (открывается сразу, без «загружаю»),
// дальше клиент обновляет данные через API. Guard тот же, что у layout: допуск проверяется и здесь —
// страница сама грузит данные и не имеет права полагаться на защиту уровнем выше.
export default async function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireEquipmentUser();
  const { id } = await params;

  // Данные достаём отдельно от рендера: JSX внутри try/catch не ловится (ошибки рендера ловит
  // только error boundary), поэтому сначала загрузка, потом — чистый возврат разметки.
  const machine = await getMachine(id, user).catch((e: unknown) => {
    if (e instanceof DomainError && e.httpStatus === 404) return null;
    throw e;
  });
  if (!machine) notFound();

  return <MachineCardClient id={id} initial={machine} />;
}
