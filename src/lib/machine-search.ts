// Умный поиск по картотеке станков (PRD §16.5). Предметная надстройка над общим движком
// `search-core.ts` — тем же, что ищет заявки: номер в любой схеме и написании («77-5», «К-5», «k5»),
// модель, № заказа 1С, комплектация, дефектовка, подписи состояния и категорий; регистр и ё/е не
// важны, неверная раскладка чинится.
//
// Поиск по заказчику, телефону, серийнику и месту на площадке убран 20.08.2026 вместе с самими
// полями (решение Артёма: карточка распухла, а эти данные живут в 1С).
//
// Активные станки (десятки) фильтруются на клиенте мгновенно; архив ищется на сервере — ЭТИМ ЖЕ
// модулем (listMachines в machine-service вызывает machineMatches), поэтому ответы клиента и
// сервера не расходятся: SQL-ILIKE не умеет ни раскладку, ни «8≈+7».
import {
  digitsWithMap,
  highlightRanges,
  matchesFields,
  parseQuery,
  phoneHighlightRanges,
  type MatchRange,
  type ParsedQuery,
} from "./search-core";
import {
  EQUIPMENT_KIND_LABEL,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
  isHeadKind,
} from "@/domain/machine-status";
import {
  formatMachineNumber,
  machineNumberSearchVariants,
  machineNumberValue,
  type NumberedMachine,
} from "@/domain/machine-number";
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";

export { parseQuery, highlightRanges, phoneHighlightRanges, type MatchRange, type ParsedQuery };

export type SearchableMachine = {
  ourNumber: number | null;
  clientNumber?: number | null;
  kind: EquipmentKind;
  categories: MachineCategory[];
  status: MachineStatus;
  model: string;
  configuration?: string | null;
  metalThickness?: string | null;
  contactName?: string | null;
  invoice1C?: string | null;
  deliveredBy?: string | null;
  defectNotes?: string | null;
  notes?: string | null;
};

/** Отображение учётного номера: «77-5» у своего железа, «К-5» у чужого. */
export function formatOurNumber(m: NumberedMachine): string | null {
  return formatMachineNumber(m);
}

// Текстовые поля станка. Подписи категорий и состояния тоже ищутся: «в ремонте» и «арендный» —
// естественные слова запроса. Станок с двумя категориями находится по любой из них.
//
// Подпись вида добавляется всем, кроме головных: «нож», «машинка» находят комплектующие, а слово
// «листогиб» в разделе листогибов было бы запросом-пустышкой, матчащим всю картотеку.
function textFields(m: SearchableMachine): string[] {
  return [
    m.model,
    m.configuration,
    m.metalThickness,
    m.contactName,
    m.invoice1C,
    m.deliveredBy,
    m.defectNotes,
    m.notes,
    formatOurNumber(m),
    // «к5», «k-5» и прочие написания клиентского номера — человек ищет как набралось.
    ...machineNumberSearchVariants(m),
    MACHINE_STATUS_LABEL[m.status],
    ...m.categories.map((c) => MACHINE_CATEGORY_LABEL[c]),
    !isHeadKind(m.kind) ? EQUIPMENT_KIND_LABEL[m.kind] : null,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
}

// Числовые «стога»: учётный номер (и как «5», и как «775» — чтобы находился запрос «77-5») и цифры
// № заказа 1С. Сквозной системный номер из поиска убран вместе с его показом (15.08.2026):
// искать по числу, которого человек больше нигде не видит, — только ложные совпадения.
function numberHaystacks(m: SearchableMachine): string[] {
  const out: string[] = [];
  const value = machineNumberValue(m);
  if (value !== null) {
    // «5» — сам номер; «775» — чтобы находился запрос «77-5» (дефис поиск не различает).
    out.push(String(value));
    if (m.ourNumber !== null) out.push(`77${value}`);
  }
  if (m.invoice1C) {
    const { digits } = digitsWithMap(m.invoice1C);
    if (digits) out.push(digits);
  }
  return out;
}

/**
 * Подходит ли станок под запрос (AND по токенам, как у задач).
 *
 * Телефона у станка больше нет (поле выведено из интерфейса 20.08.2026), поэтому «телефонный»
 * аргумент общего движка всегда пуст — цифровой путь остаётся только у номера и заказа 1С.
 */
export function machineMatches(m: SearchableMachine, q: ParsedQuery): boolean {
  return matchesFields(q, textFields(m), numberHaystacks(m), null);
}

export type HiddenMatch = { label: string; text: string };

// Карточка списка показывает номер, модель, состояние, цену и толщину. Остальное — «скрытые» поля:
// если нашлось по ним, показываем строчку-сниппет «почему нашлось».
const HIDDEN_FIELDS: {
  key: "contactName" | "invoice1C" | "configuration" | "defectNotes";
  label: string;
}[] = [
  { key: "contactName", label: "Контакт" },
  { key: "invoice1C", label: "Заказ 1С" },
  { key: "configuration", label: "Компл." },
  { key: "defectNotes", label: "Дефект" },
];

/** Первое скрытое поле со совпадением — для сниппета под карточкой. */
export function firstHiddenMachineMatch(
  m: SearchableMachine,
  q: ParsedQuery,
  visibleTexts: string[],
): HiddenMatch | null {
  if (!q.active) return null;
  const visible = [...visibleTexts, formatOurNumber(m) ?? ""];
  if (visible.some((v) => v && highlightRanges(v, q).length > 0)) return null;
  for (const f of HIDDEN_FIELDS) {
    const value = m[f.key];
    if (!value) continue;
    // Телефонной ветки здесь больше нет: поле «Телефон» выведено из карточки 20.08.2026,
    // а среди оставшихся скрытых полей номеров не бывает.
    if (highlightRanges(value, q).length > 0) return { label: f.label, text: value };
  }
  return null;
}
