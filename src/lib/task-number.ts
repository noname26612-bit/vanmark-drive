// Номер задачи так, как его называют люди — одна правда для доски, списков, карточки, телефона,
// пушей и поиска (по образцу src/domain/machine-number.ts).
//
// Две нумерации по контуру (решение Артёма 15.08.2026, вечер):
//   заявка водителю (DELIVERY) — сквозная «№615», как было с первого дня;
//   задача цеха (STAFF)        — своя, с единицы, и пишется с приставкой: «Ц-5».
//
// Приставка нужна, чтобы номера двух контуров не путались там, где они лежат рядом: во «Всех
// задачах», в поиске и в разговоре («пятая» — цеха или доставка?). Буква «Ц» — кириллическая,
// интерфейс русский; поиск при этом понимает и латинскую «c» (см. staffNumberSearchVariants).
//
// Сквозной `number` остаётся у обеих задач: это технический ключ журналов, ссылок и ошибок.
import type { TaskKind } from "@/generated/prisma/enums";

export const STAFF_NUMBER_PREFIX = "Ц-";

export type NumberedTask = {
  kind?: TaskKind | null;
  number: number;
  staffNumber?: number | null;
};

/** Контур задачи с поправкой на старые данные (в SW-кэше поля kind может не быть). */
function isStaff(task: NumberedTask): boolean {
  return (task.kind ?? "DELIVERY") === "STAFF";
}

/**
 * Номер задачи для человека: «615» у заявки, «Ц-5» у задачи цеха.
 * У задачи цеха без своего номера (данные до 16.08.2026, если такие где-то остались) честно
 * показываем сквозной — лучше настоящий номер, чем пустое место.
 */
export function taskNumber(task: NumberedTask): string {
  if (isStaff(task) && task.staffNumber != null) {
    return `${STAFF_NUMBER_PREFIX}${task.staffNumber}`;
  }
  return String(task.number);
}

/**
 * Номер с обозначением, как его пишут в интерфейсе: «№615» у заявки, «Ц-5» у задачи цеха.
 * У цеха «№» не ставим — приставка «Ц-» уже говорит, что это номер.
 */
export function taskNumberLabel(task: NumberedTask): string {
  return isStaff(task) && task.staffNumber != null
    ? `${STAFF_NUMBER_PREFIX}${task.staffNumber}`
    : `№${task.number}`;
}

/**
 * Написания номера цеха для поиска: «Ц-5» человек наберёт как получится — «ц5», «c-5» латиницей с
 * забытой раскладкой. Дешевле положить в «стог» все варианты, чем угадывать (как у станков с «К-N»).
 */
export function staffNumberSearchVariants(task: NumberedTask): string[] {
  if (!isStaff(task) || task.staffNumber == null) return [];
  const n = task.staffNumber;
  return [`ц-${n}`, `ц${n}`, `c-${n}`, `c${n}`];
}

/**
 * Разбор поискового запроса в номер цеха: «Ц-5», «ц5», «c 5» и просто «5» → 5. Всё остальное — null.
 * Ограничение длины — как у сквозного номера: длинные цифровые строки (телефон) переполнили бы Int.
 */
export function parseStaffNumberQuery(q: string): number | null {
  const m = /^[цc]?\s*-?\s*(\d{1,9})$/i.exec(q.trim());
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}
