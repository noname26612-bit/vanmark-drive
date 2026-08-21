// Фото станков (ARCHITECTURE §4г/§6). Механика та же, что у вложений задач: файл кладётся на том
// под серверным uuid-именем, отдаётся НЕ статикой, а через route handler с проверкой прав.
//
// Отличие от задач — модель доступа: у картотеки нет владельца, поэтому проверка чисто ролевая
// (assertMachineAccess). Водителю любая ручка станков отдаёт 404 — существование модуля не
// раскрываем, как и существование чужой задачи.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
import { assertMachineAccess, isMachineRole } from "./machine-access";
import { hasEquipmentAccess } from "./users";
import { validateUpload, matchesMagic } from "./attachments";
import { saveUpload, readUpload, deleteUpload } from "@/lib/uploads";
import type { Actor } from "./machine-service";
import type { Role } from "@/generated/prisma/enums";
import type { MachineAttachmentView } from "@/lib/machine-dto";

export type NewMachinePhoto = {
  bytes: Buffer;
  mimeType: string;
  sizeBytes: number;
};

// Клиенту не отдаём filePath — файл доступен только через GET /api/machines/photos/:id.
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

/**
 * Файл для раздачи, с проверкой прав СМОТРЯЩЕГО (21.08.2026).
 *
 * До появления связи заявок со станками доступ был чисто ролевым. Теперь водитель видит в телефоне
 * фото станка, который везёт, — значит и файл ему надо отдать. Путей доступа ровно два, и оба
 * узкие:
 *   1) картотека — роль из белого списка ИЛИ персональный флаг equipmentAccess (как везде в модуле);
 *   2) заявка — станок привязан к АКТИВНОЙ (не архивной) заявке, где смотрящий назначен
 *      ответственным или напарником. Ничего сверх этого: чужой станок по прямой ссылке не
 *      открывается, архивная заявка доступа больше не даёт.
 *
 * Любой отказ — 404, а не 403 (§6): существование снимка и самого модуля не раскрываем. Порядок
 * важен — сначала находим вложение, потом проверяем права: разные коды на «нет такого» и «не
 * твоё» сами по себе отвечали бы на вопрос, существует ли снимок (как в rescheduleTask).
 */
export async function getMachinePhotoForViewer(
  attachmentId: string,
  viewer: { id: string; role: Role },
) {
  const att = await prisma.machineAttachment.findUnique({
    where: { id: attachmentId },
    select: { filePath: true, mimeType: true, machineId: true },
  });
  if (!att) throw Errors.notFound();
  if (!(await canViewMachinePhoto(att.machineId, viewer))) throw Errors.notFound();
  const bytes = await readUpload(att.filePath);
  return { bytes, mimeType: att.mimeType };
}

async function canViewMachinePhoto(
  machineId: string,
  viewer: { id: string; role: Role },
): Promise<boolean> {
  // Белый список ролей — первым: у штаба лишнего похода в базу нет.
  if (isMachineRole(viewer.role)) return true;
  // Флаг читаем ИЗ БД, а не из сессии: отзыв доступа должен действовать сразу (см. api-route.ts).
  if (await hasEquipmentAccess(viewer.id)) return true;
  const link = await prisma.taskMachine.findFirst({
    where: {
      machineId,
      task: {
        archivedAt: null,
        OR: [{ assigneeId: viewer.id }, { coDriverId: viewer.id }],
      },
    },
    select: { id: true },
  });
  return link !== null;
}

/**
 * Удалить фото. Убрать снимок может любой, кто работает с картотекой — как и завести станок,
 * сменить его состояние или дописать в журнал.
 *
 * Ограничения «только автор» здесь сознательно НЕТ (в отличие от вложений задач): у задач есть
 * владелец-исполнитель, у картотеки площадки владельца нет. Иначе Максим не смог бы убрать неудачный
 * снимок, загруженный Миленой, — а кнопка удаления стоит на каждом фото, и отказ выглядел бы сбоем.
 * Факт удаления и автор действия остаются в журнале станка.
 */
export async function deleteMachinePhoto(attachmentId: string, actor: Actor): Promise<void> {
  assertMachineAccess(actor);
  const att = await prisma.machineAttachment.findUnique({
    where: { id: attachmentId },
    select: { filePath: true, machineId: true },
  });
  if (!att) throw Errors.notFound();

  await prisma.$transaction(async (tx) => {
    await tx.machineAttachment.delete({ where: { id: attachmentId } });
    await tx.machineEvent.create({
      data: { machineId: att.machineId, actorId: actor.id, kind: "photo_removed" },
    });
  });
  await deleteUpload(att.filePath);
}
