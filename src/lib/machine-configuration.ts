// Комплектация оборудования галочками вместо свободного текста (решение Артёма 20.08.2026):
// набирать «нож, машинка, стойка» руками в каждой карточке — лишняя работа и разнобой написаний,
// из-за которого одну и ту же комплектацию не сверить глазами и не найти поиском.
//
// В БД поле остаётся ОДНОЙ строкой Machine.configuration — новой колонки и таблицы не заводим
// (правило «не переусложнять»): строка уже уходит текстом в «Задание в цех» (machine-shop-task.ts)
// и печатается в карточке как есть. Галочки — производное ПРЕДСТАВЛЕНИЕ этой строки, поэтому
// здесь всего две чистые функции: разобрать строку в галочки и собрать её обратно.
//
// Дописать своё по-прежнему можно: всё, что не совпало с известным пунктом, живёт в «своём» хвосте
// и не теряется — старые карточки открываются без правки данных и сохраняются без потерь.
import type { EquipmentKind } from "@/generated/prisma/enums";

// Пункты — только у головных видов: у листогиба и фальцепрокатника комплектация есть, у ножа и
// складских позиций (размотчик, частотник) её нет — там останется одно свободное поле.
export const CONFIGURATION_OPTIONS: Partial<Record<EquipmentKind, readonly string[]>> = {
  MACHINE: ["Роликовый нож", "Машинка", "Стойка"],
  SEAMER: ["Размотчик", "Частотник"],
};

const NO_OPTIONS: readonly string[] = [];

/** Пункты вида. Пустой список — галочек у вида нет, вся комплектация вводится текстом. */
export function configurationOptionsFor(kind: EquipmentKind): readonly string[] {
  return CONFIGURATION_OPTIONS[kind] ?? NO_OPTIONS;
}

/** Состояние формы: отмеченные пункты + дописанное руками. */
export type ConfigurationParts = { selected: string[]; custom: string };

const SEPARATOR = ", ";

// Пункт узнаём «как человек»: в карточках уже лежат «Роликовый нож», «роликовый нож» и
// «Роликовый  нож» — это одно и то же железо, значит и галочка одна.
function matchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Строка из БД → состояние формы. Известные пункты становятся галочками в КАНОНИЧЕСКОМ порядке и
 * каноническом написании (порядок слов в строке произвольный, а галочки не должны прыгать между
 * карточками), всё остальное уходит в «своё» поле как есть — исходным порядком и написанием.
 */
export function splitConfiguration(kind: EquipmentKind, raw: string | null): ConfigurationParts {
  const options = configurationOptionsFor(kind);
  const canonical = new Map<string, string>(options.map((o) => [matchKey(o), o] as const));
  const chosen = new Set<string>();
  const rest: string[] = [];

  for (const piece of (raw ?? "").split(",")) {
    const value = piece.trim();
    if (value === "") continue; // «нож,,стойка» и хвостовая запятая — не пункт, а опечатка
    const known = canonical.get(matchKey(value));
    if (known) chosen.add(known); // Set — потому что «нож, нож» должен дать одну галочку
    else rest.push(value);
  }

  return { selected: options.filter((o) => chosen.has(o)), custom: rest.join(SEPARATOR) };
}

/**
 * Состояние формы → строка для БД. Пункты идут в каноническом порядке, «своё» — в хвосте: одинаковая
 * комплектация у разных карточек обязана выглядеть одинаково, иначе задание в цех и поиск разъедутся.
 *
 * Идём по списку вида, а не по selected: чужие для вида пункты (остались от смены вида в форме)
 * отбрасываются сами, дубликаты схлопываются, пустые части не попадают в строку.
 */
export function joinConfiguration(
  kind: EquipmentKind,
  selected: readonly string[],
  custom: string,
): string {
  const keys = new Set(selected.map(matchKey));
  const parts = configurationOptionsFor(kind).filter((o) => keys.has(matchKey(o)));
  const tail = custom.trim();
  if (tail !== "") parts.push(tail);
  return parts.join(SEPARATOR);
}
