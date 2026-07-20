// Доменный сервис вложений (ARCHITECTURE §6). Вся изоляция — здесь: видеть/трогать вложение
// может только тот, кто видит задачу (водитель — свою; чужая → 404). Файл хранится на томе,
// раздаётся НЕ статикой, а через GET /api/attachments/:id с этими проверками.
import { prisma } from "@/lib/prisma";
import type { AttachmentKind, Role } from "@/generated/prisma/enums";
import { canViewTask } from "./authz";
import { isDispatcherRole } from "./task-status";
import { validateUpload, matchesMagic } from "./attachments";
import { markWorksheetSigned, revertWorksheetSignIfNoDocs } from "./work-service";
import { Errors } from "./errors";
import { saveUpload, readUpload, deleteUpload } from "@/lib/uploads";

export type Actor = { id: string; role: Role };

export type NewAttachment = {
  bytes: Buffer;
  mimeType: string;
  sizeBytes: number;
  kind?: AttachmentKind; // PHOTO (по умолчанию) | DOCUMENT (подписанный акт, Фаза 1.5)
  lat?: number | null;
  lng?: number | null;
};

// Что отдаём клиенту: без filePath/sizeBytes — файл доступен только через /api/attachments/:id.
const attachmentSelect = {
  id: true,
  kind: true,
  mimeType: true,
  createdById: true,
  lat: true,
  lng: true,
  createdAt: true,
} as const;

/** Загрузка фото к задаче. Изоляция: только кто видит задачу. Имя файла генерит сервер. */
export async function addAttachment(taskId: string, actor: Actor, input: NewAttachment) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true, coDriverId: true, status: true },
  });
  if (!task) throw Errors.notFound();
  if (!canViewTask(actor, task)) throw Errors.notFound(); // чужая → 404, не 403
  if (task.status === "CANCELLED") throw Errors.validation("Задача отменена");

  const kind: AttachmentKind = input.kind ?? "PHOTO";
  const verdict = validateUpload(input.mimeType, input.sizeBytes, kind);
  if (!verdict.ok) {
    if (verdict.code === "BAD_MIME") {
      throw Errors.uploadInvalid(kind === "DOCUMENT" ? "Акт — фото или PDF" : "Можно загружать только фото");
    }
    if (verdict.code === "TOO_LARGE") throw Errors.uploadInvalid("Файл больше 15 МБ");
    throw Errors.uploadInvalid("Пустой файл");
  }
  // Сверка реальной сигнатуры с заявленным mime (preflight-аудит): file.type приходит от клиента,
  // без этой проверки бинарник можно загрузить под видом image/jpeg.
  if (!matchesMagic(input.bytes, input.mimeType)) {
    throw Errors.uploadInvalid(kind === "DOCUMENT" ? "Файл не похож на фото или PDF" : "Файл не похож на изображение");
  }

  const filePath = await saveUpload(input.bytes, input.mimeType);
  const data = {
    taskId,
    kind,
    filePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    createdById: actor.id,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  };
  // Акт (DOCUMENT) на уже расценённой ведомости закрывает её цикл PRICED→SIGNED (PRD §13.4, этап 14).
  // Создание вложения и смена статуса — атомарно, в одной транзакции.
  if (kind === "DOCUMENT") {
    return prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({ data, select: attachmentSelect });
      await markWorksheetSigned(tx, taskId, actor.id);
      return created;
    });
  }
  return prisma.attachment.create({ data, select: attachmentSelect });
}

/** Файл для раздачи. Изоляция: чужая задача → 404. */
export async function getAttachmentForDownload(attachmentId: string, actor: Actor) {
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { filePath: true, mimeType: true, task: { select: { assigneeId: true, coDriverId: true } } },
  });
  if (!att) throw Errors.notFound();
  if (!canViewTask(actor, att.task)) throw Errors.notFound();
  const bytes = await readUpload(att.filePath);
  return { bytes, mimeType: att.mimeType };
}

/** Удаление вложения (до завершения): свой автор или диспетчер. Изоляция: чужая задача → 404. */
export async function deleteAttachment(attachmentId: string, actor: Actor): Promise<void> {
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      filePath: true,
      createdById: true,
      kind: true,
      taskId: true,
      task: { select: { assigneeId: true, coDriverId: true, status: true } },
    },
  });
  if (!att) throw Errors.notFound();
  if (!canViewTask(actor, att.task)) throw Errors.notFound();
  if (att.createdById !== actor.id && !isDispatcherRole(actor.role)) throw Errors.forbidden();
  if (att.task.status === "DONE") throw Errors.validation("Нельзя удалить фото завершённой задачи");

  // Удаление последнего акта откатывает ведомость SIGNED→PRICED (этап 14) — атомарно с удалением.
  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: attachmentId } });
    if (att.kind === "DOCUMENT") {
      await revertWorksheetSignIfNoDocs(tx, att.taskId, actor.id);
    }
  });
  await deleteUpload(att.filePath);
}
