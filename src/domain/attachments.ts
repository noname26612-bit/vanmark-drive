// Чистые правила вложений (без prisma/fs) — тестируются юнитом. Серверные операции — в
// attachment-service.ts. Лимиты из PRD §9 и security-check.

// PRD §9: ~5–20 МБ/задача суммарно, фото сжимаются на клиенте до ~1920px. На один файл — ≤15 МБ
// (запас под несжатый кадр; security-check: «фото ≤ 15 МБ»).
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// Акт-документ (Фаза 1.5) — фото подписанного акта или PDF-скан.
const ALLOWED_DOC_MIME = new Set([...ALLOWED_MIME, "application/pdf"]);

export function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

export function isAllowedDocMime(mime: string): boolean {
  return ALLOWED_DOC_MIME.has(mime);
}

export type UploadKind = "PHOTO" | "DOCUMENT";

export type UploadVerdict =
  | { ok: true }
  | { ok: false; code: "EMPTY" | "BAD_MIME" | "TOO_LARGE" };

/** Валидация загружаемого файла: непустой, разрешённый mime (фото — только image; акт — image+pdf),
 *  в пределах лимита размера. */
export function validateUpload(mimeType: string, sizeBytes: number, kind: UploadKind = "PHOTO"): UploadVerdict {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, code: "EMPTY" };
  const mimeOk = kind === "DOCUMENT" ? isAllowedDocMime(mimeType) : isAllowedImageMime(mimeType);
  if (!mimeOk) return { ok: false, code: "BAD_MIME" };
  if (sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, code: "TOO_LARGE" };
  return { ok: true };
}

/** Нужно ли блокировать DONE из-за отсутствия отчётного фото (PRD §5, ARCHITECTURE §5).
 *  Чистая функция — общая для unit-теста и для серверного гейта в transitionTask. */
export function isReportPhotoMissing(requiresPhoto: boolean, reportPhotoCount: number): boolean {
  return requiresPhoto && reportPhotoCount <= 0;
}
