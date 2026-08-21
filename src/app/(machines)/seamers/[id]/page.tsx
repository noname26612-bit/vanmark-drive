import { notFound } from "next/navigation";
import { requireEquipmentUser } from "@/lib/session";
import { getMachine } from "@/domain/machine-service";
import { DomainError } from "@/domain/errors";
import { isTaskManagerRole } from "@/domain/task-access";
import { MachineCardClient } from "../../machines/[id]/machine-card-client";

export const dynamic = "force-dynamic";

// Карточка из раздела «Фальцепрокатники». Компонент карточки общий с листогибами — различается
// только раздел, в который ведёт кнопка «назад»: заводить вторую копию экрана значило бы чинить
// каждую правку дважды.
export default async function SeamerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireEquipmentUser();
  const { id } = await params;

  const machine = await getMachine(id, user).catch((e: unknown) => {
    if (e instanceof DomainError && e.httpStatus === 404) return null;
    throw e;
  });
  if (!machine) notFound();

  return (
    <MachineCardClient
      id={id}
      initial={machine}
      basePath="/seamers"
      canOpenTasks={isTaskManagerRole(user.role)}
    />
  );
}
