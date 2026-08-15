// Учётный номер станка — одна правда для сервера, списка, карточки, формы и поиска.
//
// Схем две, по происхождению железа (решение Артёма 15.08.2026, вечер):
//   своё (OUR_SALE, OUR_RENTAL) — «77-N»,  чужое (CLIENT) — «К-N».
// Номер следует за категорией: перевели станок в клиентские — он получает следующий свободный
// «К-N», а «77-N» освобождается (и наоборот). Внутри своей схемы (продажа ↔ аренда) номер не
// меняется: это одно и то же железо одного парка.
//
// Буква «К» пишется КИРИЛЛИЦЕЙ — маркером на железе её пишут в русской раскладке, и весь интерфейс
// русский. Поиск при этом понимает оба алфавита (см. machineNumberSearchVariants): человек ищет
// как получилось, а не как задумано.
import type { MachineCategory } from "@/generated/prisma/enums";
import { isOurCategory } from "./machine-status";

export type NumberScheme = "OUR" | "CLIENT";

export const NUMBER_PREFIX: Record<NumberScheme, string> = {
  OUR: "77-",
  CLIENT: "К-",
};

/** Какой схемой нумеруется станок этой категории. */
export function numberSchemeFor(category: MachineCategory): NumberScheme {
  return isOurCategory(category) ? "OUR" : "CLIENT";
}

/** Поле номера, в котором живёт номер этой категории. Второе поле у станка всегда пустое. */
export function numberFieldFor(category: MachineCategory): "ourNumber" | "clientNumber" {
  return numberSchemeFor(category) === "OUR" ? "ourNumber" : "clientNumber";
}

export type NumberedMachine = {
  category: MachineCategory;
  ourNumber: number | null;
  clientNumber?: number | null;
};

/** Номер станка в его схеме (число), или null — номера нет. */
export function machineNumberValue(m: NumberedMachine): number | null {
  const value = numberSchemeFor(m.category) === "OUR" ? m.ourNumber : (m.clientNumber ?? null);
  return value ?? null;
}

/** Номер так, как он написан маркером на железе: «77-5» или «К-5». null — номера нет. */
export function formatMachineNumber(m: NumberedMachine): string | null {
  const value = machineNumberValue(m);
  if (value === null) return null;
  return `${NUMBER_PREFIX[numberSchemeFor(m.category)]}${value}`;
}

/** Номер с явной схемой — когда категория ещё не выбрана (форма) или нужна чужая схема. */
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
  if (value === null || numberSchemeFor(m.category) !== "CLIENT") return [];
  return [`к-${value}`, `к${value}`, `k-${value}`, `k${value}`];
}
