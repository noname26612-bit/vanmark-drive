// Хранение файлов фото-отчётов на локальном томе (ARCHITECTURE §9). Имя файла генерит сервер
// (uuid.ext) — клиент имя/путь не задаёт. Файлы вне public/: раздача только через
// GET /api/attachments/:id с проверкой прав (см. attachment-service). Только серверный рантайм.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "./data/uploads";

export function uploadsRoot(): string {
  return path.resolve(UPLOADS_DIR);
}

// Разрешённые типы изображений → расширение файла. Источник правды по mime — domain/attachments.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

/** Сохраняет байты под серверным uuid-именем. Возвращает относительное имя (filePath в БД). */
export async function saveUpload(bytes: Buffer, mime: string): Promise<string> {
  const root = uploadsRoot();
  await fs.mkdir(root, { recursive: true });
  const name = `${randomUUID()}.${extForMime(mime)}`;
  await fs.writeFile(path.join(root, name), bytes);
  return name;
}

// Резолвит абсолютный путь и гарантирует, что он внутри uploadsRoot (защита от path traversal,
// хотя filePath — серверный uuid без слешей; проверка на всякий случай).
function resolveInside(filePath: string): string {
  const root = uploadsRoot();
  const abs = path.resolve(root, filePath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Недопустимый путь файла");
  }
  return abs;
}

export async function readUpload(filePath: string): Promise<Buffer> {
  return fs.readFile(resolveInside(filePath));
}

export async function deleteUpload(filePath: string): Promise<void> {
  await fs.rm(resolveInside(filePath), { force: true });
}
