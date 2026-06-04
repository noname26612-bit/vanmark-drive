// Клиентское сжатие фото до ~1920px по большей стороне (PRD §9) средствами Canvas — без библиотек
// (CLAUDE.md правило 6). Грейсфул-фолбэк: если браузер не декодит файл (HEIC) или нет canvas —
// возвращаем оригинал, сервер всё равно валидирует mime/размер и примет image/*.
export const MAX_DIMENSION = 1920;
export const JPEG_QUALITY = 0.8;

export async function compressImage(
  file: File,
  maxDim = MAX_DIMENSION,
  quality = JPEG_QUALITY,
): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    if (scale >= 1) {
      bitmap.close();
      return file; // уже не крупнее лимита — не перекодируем
    }
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file; // HEIC и прочее, что не декодится — отдаём как есть
  }
}
