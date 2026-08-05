// Фото станков (ARCHITECTURE §4г/§6). Механика та же, что у вложений задач: файл кладётся на том
// под серверным uuid-именем, отдаётся НЕ статикой, а через route handler с проверкой прав.
//
// Отличие от задач — модель доступа: у картотеки нет владельца, поэтому проверка чисто ролевая
// (assertMachineAccess). Водителю любая ручка станков отдаёт 404 — существование модуля не
// раскрываем, как и существование чужой задачи.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { assertMachineAccess } from "./machine-access";
import { validateUpload, matchesMagic } from "./attachments";
import { saveUpload, readUpload, deleteUpload } from "@/lib/uploads";
import type { Actor } from "./machine-service";
import type { MachineAttachmentView } from "@/lib/machine-dto";

export type NewMachinePhoto = {
  bytes: Buffer;
  mimeType: string;
  sizeBytes: number;
};

// Клиенту не отдаём filePath — файл доступен только через /api/machines/attachments/:id.
const attachmentSelect = { id: true, mimeType: true, createdAt: true } as const;

/**
 * Добавить фото станку. Карточка создаётся отдельно и раньше: фото догружаются следом с
 * автоповтором, поэтому обрыв связи на площадке не теряет введённые данные (PRD §16.5).
 */
export async function addMachinePhoto(
  machineId: string,
  actor: Actor,
  input: NewMachinePhoto,
): Promise<MachineAttachmentView> {
  assertMachineAccess(actor);
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { id: true },
  });
  if (!machine) throw Errors.notFound();

  const verdict = validateUpload(input.mimeType, input.sizeBytes, "PHOTO");
  if (!verdict.ok) {
    if (verdict.code === "BAD_MIME") throw Errors.uploadInvalid("Можно загружать только фото");
    if (verdict.code === "TOO_LARGE") throw Errors.uploadInvalid("Файл больше 15 МБ");
    throw Errors.uploadInvalid("Пустой файл");
  }
  // Сверка сигнатуры с заявленным mime: file.type приходит от клиента и подделывается.
  if (!matchesMagic(input.bytes, input.mimeType)) {
    throw Errors.uploadInvalid("Файл не похож на изображение");
  }

  const filePath = await saveUpload(input.bytes, input.mimeType);
  const created = await prisma.$transaction(async (tx) => {
    const att = await tx.machineAttachment.create({
      data: {
        machineId,
        filePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        createdById: actor.id,
      },
      select: attachmentSelect,
    });
    await tx.machineEvent.create({
      data: { machineId, actorId: actor.id, kind: "photo_added" },
    });
    return att;
  });

  return {
    id: created.id,
    mimeType: created.mimeType,
    createdAt: created.createdAt.toISOString(),
  };
}

/** Файл для раздачи. Доступ — только роли модуля; иначе 404. */
export async function getMachinePhotoForDownload(attachmentId: string, actor: Actor) {
  assertMachineAccess(actor);
  const att = await prisma.machineAttachment.findUnique({
    where: { id: attachmentId },
    select: { filePath: true, mimeType: true },
  });
  if (!att) throw Errors.notFound();
  const bytes = await readUpload(att.filePath);
  return { bytes, mimeType: att.mimeType };
}

/**
 * Удалить фото. Свой снимок может убрать автор; чужой — диспетчер или админ (Максим чужие фото
 * не удаляет — это тот же принцип, что с вложениями задач: убирает автор либо старший по роли).
 * Событие пишется в журнал: картотека должна помнить, что фото было и кто его убрал.
 */
export async function deleteMachinePhoto(attachmentId: string, actor: Actor): Promise<void> {
  assertMachineAccess(actor);
  const att = await prisma.machineAttachment.findUnique({
    where: { id: attachmentId },
    select: { filePath: true, createdById: true, machineId: true },
  });
  if (!att) throw Errors.notFound();
  const isElevated = actor.role === "ADMIN" || actor.role === "DISPATCHER";
  if (att.createdById !== actor.id && !isElevated) throw Errors.forbidden();

  await prisma.$transaction(async (tx) => {
    await tx.machineAttachment.delete({ where: { id: attachmentId } });
    await tx.machineEvent.create({
      data: { machineId: att.machineId, actorId: actor.id, kind: "photo_removed" },
    });
  });
  await deleteUpload(att.filePath);
}
