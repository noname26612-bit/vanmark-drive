// Учётный номер станка — одна правда для сервера, списка, карточки, формы и поиска.
//
// Схем две, по происхождению железа (решение Артёма 15.08.2026, вечер):
//   своё (наш на продажу / наш арендный) — «77-N»,  чужое (клиентский) — «К-N».
// Номер следует за категориями: перевели станок в клиентские — он получает следующий свободный
// «К-N», а «77-N» освобождается (и наоборот). Внутри своей схемы (продажа ↔ аренда, в том числе
// когда обе категории стоят вместе) номер не меняется: это одно и то же железо одного парка.
//
// ПОЧЕМУ ФОРМАТ ЧИТАЕТСЯ ИЗ ПОЛЕЙ, А НЕ ИЗ КАТЕГОРИЙ (20.08.2026): с переходом на список категорий
// «клиентскость» перестала быть одним значением, зато у станка по-прежнему заполнено не больше
// одного номерного поля — и оно само говорит, в какой схеме номер выдан. Так номер печатается
// одинаково везде, включая места, где категорий под рукой нет (комплект, задание в цех), и не
// теряется в момент, когда категории меняют, а номер ещё переезжает.
//
// Буква «К» пишется КИРИЛЛИЦЕЙ — маркером на железе её пишут в русской раскладке, и весь интерфейс
// русский. Поиск при этом понимает оба алфавита (см. machineNumberSearchVariants): человек ищет
// как получилось, а не как задумано.
import type { MachineCategory } from "@/generated/prisma/enums";
import { isOurCategories } from "./machine-status";

export type NumberScheme = "OUR" | "CLIENT";

export const NUMBER_PREFIX: Record<NumberScheme, string> = {
  OUR: "77-",
  CLIENT: "К-",
};

/** Какой схемой нумеруется станок с такими категориями. Есть «Клиентский» — чужая схема. */
export function numberSchemeFor(categories: readonly MachineCategory[]): NumberScheme {
  return isOurCategories(categories) ? "OUR" : "CLIENT";
}

/** Поле номера для этих категорий. Второе поле у станка всегда пустое. */
export function numberFieldFor(
  categories: readonly MachineCategory[],
): "ourNumber" | "clientNumber" {
  return numberSchemeFor(categories) === "OUR" ? "ourNumber" : "clientNumber";
}

export type NumberedMachine = {
  ourNumber: number | null;
  clientNumber?: number | null;
};

/** Схема, в которой номер фактически выдан, или null — номера нет. */
export function schemeOfNumber(m: NumberedMachine): NumberScheme | null {
  if (m.ourNumber !== null && m.ourNumber !== undefined) return "OUR";
  if (m.clientNumber !== null && m.clientNumber !== undefined) return "CLIENT";
  return null;
}

/** Номер станка в его схеме (число), или null — номера нет. */
export function machineNumberValue(m: NumberedMachine): number | null {
  return m.ourNumber ?? m.clientNumber ?? null;
}

/** Номер так, как он написан маркером на железе: «77-5» или «К-5». null — номера нет. */
export function formatMachineNumber(m: NumberedMachine): string | null {
  const scheme = schemeOfNumber(m);
  const value = machineNumberValue(m);
  if (scheme === null || value === null) return null;
  return `${NUMBER_PREFIX[scheme]}${value}`;
}

/** Номер с явной схемой — когда категории ещё не выбраны (форма) или нужна чужая схема. */
export function formatNumberIn(scheme: NumberScheme, value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `${NUMBER_PREFIX[scheme]}${value}`;
}

/**
 * Написания номера для поиска. Клиентский «К-5» человек наберёт как угодно: «к5», «k-5», латиницей
 * с забытой раскладкой. Общий движок поиска чинит раскладку слов, но «к»/«k» — одна буква, и
 * дешевле положить в «стог» оба варианта, чем угадывать.
 *
 * Своё «77-5» отдельных вариантов не требует: цифровой путь поиска уже кладёт «5» и «775».
 */
export function machineNumberSearchVariants(m: NumberedMachine): string[] {
  const value = machineNumberValue(m);
  if (value === null || schemeOfNumber(m) !== "CLIENT") return [];
  return [`к-${value}`, `к${value}`, `k-${value}`, `k${value}`];
}
