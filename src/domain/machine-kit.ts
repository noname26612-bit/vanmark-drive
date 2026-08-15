// Комплектация оборудования (решение Артёма 15.08.2026): «определённый нож идёт к определённому
// станку», размотчик и частотник — к своему фальцепрокатнику. Заданный комплект продаётся,
// сдаётся в аренду и уходит в ремонт целиком.
//
// Чистые функции без prisma — покрыты юнит-тестами. Работа с БД живёт в machine-service.ts.
//
// Две механики в одной таблице, различаются видом части:
//   • уникальный экземпляр (нож) — ровно один комплект, qty всегда 1, состояние переносится с
//     головного;
//   • складская позиция (размотчик, частотник) — карточка = модель с остатком, входит в любое
//     число комплектов, но суммарно не больше остатка; состояния у неё нет, вместо переноса —
//     резерв (аренда) и списание (продажа).
import type { EquipmentFamily, EquipmentKind, MachineStatus } from "@/generated/prisma/enums";
import { familyOfKind, isHeadKind, isStockKind } from "./machine-status";
import { Errors } from "./errors";

/** Связь комплекта в объёме, которого хватает для всех расчётов остатка. */
export type KitLink = { qty: number; consumedAt: Date | string | null };

export type KitSide = {
  id: string;
  family: EquipmentFamily;
  kind: EquipmentKind;
  quantity: number;
};

/**
 * Сколько штук складской позиции уже разобрано по комплектам. Списанные связи (consumedAt) не
 * считаем: их количество уже вычтено из quantity продажей, иначе остаток уменьшился бы дважды.
 */
export function stockUsage(links: readonly KitLink[]): number {
  return links.reduce((sum, l) => (l.consumedAt === null ? sum + l.qty : sum), 0);
}

/**
 * Свободный остаток складской позиции = всего минус разобранное по комплектам. Приписанная к
 * фальцепрокатнику штука занята, даже если он ещё стоит на площадке: иначе один размотчик молча
 * уехал бы в составе трёх разных комплектов.
 */
export function freeStock(quantity: number, links: readonly KitLink[]): number {
  return Math.max(0, quantity - stockUsage(links));
}

/**
 * Проверка перед сборкой комплекта. Порядок сообщений — от грубых ошибок к тонким, тексты
 * человеческие: это ввод оператора, а не программный контракт.
 *
 * @param existingLinksOfPart связи ЭТОЙ части со всеми головными (для уникальной — чтобы поймать
 *   второй комплект, для складской — чтобы посчитать остаток). Связь с тем же головным исключает
 *   вызывающий: повторное добавление — это правка количества.
 */
export function assertAttachable(
  head: KitSide,
  part: KitSide,
  qty: number,
  existingLinksOfPart: readonly KitLink[],
): void {
  if (head.id === part.id) throw Errors.validation("Станок нельзя добавить в комплект сам к себе");
  if (!isHeadKind(head.kind)) {
    throw Errors.validation("Комплект собирается только у станка, а не у комплектующей");
  }
  if (isHeadKind(part.kind)) {
    throw Errors.validation("В комплект добавляют комплектующую, а не второй станок");
  }
  if (familyOfKind(part.kind) !== head.family || part.family !== head.family) {
    throw Errors.validation("Комплектующая из другого раздела");
  }

  if (!isStockKind(part.kind)) {
    if (qty !== 1) throw Errors.validation("Такая комплектующая добавляется по одной штуке");
    if (existingLinksOfPart.some((l) => l.consumedAt === null)) {
      throw Errors.validation("Эта комплектующая уже стоит в другом комплекте");
    }
    return;
  }

  if (!Number.isInteger(qty) || qty < 1) throw Errors.validation("Укажите количество — целое число от 1");
  const free = freeStock(part.quantity, existingLinksOfPart);
  if (qty > free) {
    throw Errors.validation(
      free === 0 ? "Свободных штук не осталось" : `Свободно только ${free} шт — уменьшите количество`,
    );
  }
}

/**
 * Переносится ли состояние головного на уникальные части комплекта. Аннулирование не переносим:
 * VOIDED означает «карточка заведена по ошибке», а ошибка одной карточки не делает ошибочными
 * остальные — их разбирают руками.
 */
export function transfersStatus(status: MachineStatus): boolean {
  return status !== "VOIDED";
}

/**
 * Списывает ли переход складские остатки комплекта. Железо уехало с площадки насовсем — продано
 * или выдано клиенту. Аренда (RENTED) НЕ списывает: штуки уже заняты резервом и вернутся.
 */
export function consumesStock(status: MachineStatus): boolean {
  return status === "SOLD" || status === "RELEASED";
}
