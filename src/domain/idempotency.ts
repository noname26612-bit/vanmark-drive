// Идемпотентность офлайн-досылки (модель ProcessedAction, ARCHITECTURE §6). Когда водитель работает
// без сети, клиент присваивает каждому действию уникальный ключ (Idempotency-Key, uuid v4) и при
// возврате связи повторяет запрос, пока не получит подтверждение. Сервер должен выполнить действие
// РОВНО ОДИН раз: первый успех сохраняется, повтор с тем же ключом возвращает сохранённый результат,
// не выполняя действие снова. Иначе повтор задвоил бы фото/комментарий или упал бы на матрице
// статусов (второй DONE из DONE недопустим).
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { Errors } from "./errors";

/**
 * Оборачивает мутацию в идемпотентный барьер по ключу `key` (Idempotency-Key с клиента).
 *
 * - `key` пуст (обычный онлайн-запрос без офлайн-очереди) → просто выполняем `run()`.
 * - ключ уже обработан этим же пользователем → возвращаем сохранённый результат, `run()` НЕ вызываем.
 * - ключ принадлежит другому пользователю → 404 (та же изоляция, что у задач: чужое не раскрываем).
 * - новый ключ → выполняем `run()` и при успехе сохраняем результат.
 *
 * Кэшируются только успехи: если `run()` бросил (доменная или сетевая ошибка) — НЕ сохраняем, чтобы
 * повтор мог оказаться валидным (например, смена открылась — и теперь IN_PROGRESS пройдёт).
 *
 * Досылка идёт строго последовательно (один синхронизатор на устройство), поэтому гонок по одному
 * ключу на практике нет; P2002 на записи реестра трактуем как «уже сохранено параллельно» и не падаем.
 */
export async function withIdempotency<T>(
  key: string | null | undefined,
  actor: { id: string },
  kind: string,
  run: () => Promise<T>,
): Promise<T> {
  const trimmed = key?.trim();
  if (!trimmed) return run();

  const prior = await prisma.processedAction.findUnique({ where: { key: trimmed } });
  if (prior) {
    if (prior.userId !== actor.id) throw Errors.notFound(); // чужой ключ — не раскрываем существование
    // resultJson — снимок ответа первого выполнения (даты уже сериализованы в строки); уходит в
    // NextResponse.json так же, как живой результат. Каст к T осознанный (см. комментарий выше).
    return prior.resultJson as T;
  }

  const result = await run();

  // resultJson — required Json. Действия-эффекты без возвращаемого значения (комментарий, удаление
  // вложения/позиции) резолвятся в undefined, а Prisma 7.x отвергает undefined в обязательном поле
  // («Argument `resultJson` is missing») — это роняло весь барьер 500-й ошибкой, из-за чего действие
  // вечно висело в очереди и `break` в синхронизаторе намертво блокировал ВСЮ досылку (инцидент 04.07).
  // Пишем JSON null как «эффект без результата»; при повторе такие действия отдадут null — роут его
  // игнорирует, а идемпотентность (run() больше не вызывается) сохраняется.
  const resultJson = result === undefined ? Prisma.JsonNull : (result as unknown as Prisma.InputJsonValue);

  try {
    await prisma.processedAction.create({
      data: { key: trimmed, userId: actor.id, kind, resultJson },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }

  return result;
}

/**
 * Чистка реестра идемпотентности (O11): удаляет записи старше `olderThanDays` дней. Реестр нужен лишь
 * чтобы досылка не задвоила уже применённое действие, а окно достоверности клиентского времени —
 * 36 часов (`occurred-at.ts`); 60 дней ≫ этого окна, так что удаление старых записей безопасно
 * (действие такого возраста уже не досылается). Гоняется ночным cron — вечный реестр не пухнет.
 */
export async function cleanupProcessedActions(olderThanDays: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const res = await prisma.processedAction.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}
