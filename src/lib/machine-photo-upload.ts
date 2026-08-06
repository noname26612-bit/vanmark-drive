// Догрузка фото станка с автоповтором (PRD §16.5, поправка совета №9).
//
// Почему отдельно от создания карточки: связь на площадке слабая, а самое дорогое — введённые
// руками данные. Карточка сохраняется первым же запросом и мгновенно, фото уезжают следом и
// переживают обрыв: каждое несёт свой Idempotency-Key, поэтому повтор не задваивает снимок.
//
// Офлайн-очередь водителя (src/lib/offline) здесь НЕ используется — она про изоляцию задач и
// придёт в модуль на этапе 2 вместе с офлайн-просмотром картотеки.
import { apiUpload, ApiError } from "./fetcher";
import { compressImage } from "./image-compress";
import { delay } from "./retry";

// 6 попыток ≈ 1+2+4+8+8 с паузами — минута борьбы за снимок. Дальше показываем «не загрузилось»
// с кнопкой повтора: бесконечно крутить в фоне бессмысленно, человек уже ушёл к следующему станку.
const MAX_ATTEMPTS = 6;
const MAX_DELAY_MS = 8000;

export type UploadProgress = {
  done: number;
  total: number;
  failed: number;
};

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function uploadOne(machineId: string, file: File, signal?: AbortSignal): Promise<void> {
  const blob = await compressImage(file);
  const form = new FormData();
  // Имя файла на сервере не используется (он генерит uuid), но FormData требует его для File.
  form.append("file", blob, file.name || "photo.jpg");
  const key = newKey(); // один ключ на все попытки — в этом и смысл идемпотентности

  for (let attempt = 0; ; attempt++) {
    try {
      await apiUpload(`/api/machines/${machineId}/attachments`, form, { "Idempotency-Key": key });
      return;
    } catch (e) {
      // Доменный отказ (не то фото, слишком большое, нет прав) — повтор не поможет.
      if (e instanceof ApiError && !e.retryable) throw e;
      if (signal?.aborted || attempt + 1 >= MAX_ATTEMPTS) throw e;
      await delay(Math.min(MAX_DELAY_MS, 1000 * 2 ** attempt), signal);
    }
  }
}

/**
 * Загружает фото по одному (последовательно — на слабой сети параллель только мешает).
 * Возвращает список файлов, которые загрузить не удалось: их UI предложит повторить.
 */
export async function uploadMachinePhotos(
  machineId: string,
  files: File[],
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<File[]> {
  const failed: File[] = [];
  let done = 0;
  for (const file of files) {
    try {
      await uploadOne(machineId, file, signal);
      done++;
    } catch {
      failed.push(file);
    }
    onProgress?.({ done, total: files.length, failed: failed.length });
  }
  return failed;
}
