// Умный поиск по картотеке станков (PRD §16.5). Предметная надстройка над общим движком
// `search-core.ts` — тем же, что ищет заявки: номер, модель, заказчик, телефон в любом формате,
// № заказа 1С, серийник, место на площадке; регистр и ё/е не важны, неверная раскладка чинится.
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
} from "@/domain/machine-status";
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";

export { parseQuery, highlightRanges, phoneHighlightRanges, type MatchRange, type ParsedQuery };

export type SearchableMachine = {
  number: number;
  ourNumber: number | null;
  kind: EquipmentKind;
  category: MachineCategory;
  status: MachineStatus;
  model: string;
  configuration?: string | null;
  metalThickness?: string | null;
  serialNumber?: string | null;
  orgName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  invoice1C?: string | null;
  location?: string | null;
  deliveredBy?: string | null;
  defectNotes?: string | null;
  notes?: string | null;
};

/** Отображение нашего номера: «77-5». Наши станки маркируются так же на железе. */
export function formatOurNumber(ourNumber: number | null | undefined): string | null {
  return ourNumber === null || ourNumber === undefined ? null : `77-${ourNumber}`;
}

// Текстовые поля станка (телефон отдельно — он сравнивается по цифрам). Подписи категории и
// состояния тоже ищутся: «в ремонте» и «арендный» — естественные слова запроса.
function textFields(m: SearchableMachine): string[] {
  return [
    m.model,
    m.configuration,
    m.metalThickness,
    m.serialNumber,
    m.orgName,
    m.contactName,
    m.invoice1C,
    m.location,
    m.deliveredBy,
    m.defectNotes,
    m.notes,
    formatOurNumber(m.ourNumber),
    MACHINE_STATUS_LABEL[m.status],
    MACHINE_CATEGORY_LABEL[m.category],
    // Подпись вида — только у ножей: «нож»/«роликовый» находит их, а слово «станок» не
    // превращается в запрос-пустышку, матчащий всю картотеку.
    m.kind !== "MACHINE" ? EQUIPMENT_KIND_LABEL[m.kind] : null,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
}

// Числовые «стога»: учётный №, наш номер (и как «5», и как «775» — чтобы находился запрос «77-5»),
// цифры № заказа 1С и серийника.
function numberHaystacks(m: SearchableMachine): string[] {
  const out = [String(m.number)];
  if (m.ourNumber !== null && m.ourNumber !== undefined) {
    out.push(String(m.ourNumber), `77${m.ourNumber}`);
  }
  for (const raw of [m.invoice1C, m.serialNumber]) {
    if (!raw) continue;
    const { digits } = digitsWithMap(raw);
    if (digits) out.push(digits);
  }
  return out;
}

/** Подходит ли станок под запрос (AND по токенам, как у задач). */
export function machineMatches(m: SearchableMachine, q: ParsedQuery): boolean {
  return matchesFields(q, textFields(m), numberHaystacks(m), m.contactPhone);
}

export type HiddenMatch = { label: string; text: string; phone: boolean };

// Карточка списка показывает номера, модель, состояние и место. Остальное — «скрытые» поля:
// если нашлось по ним, показываем строчку-сниппет «почему нашлось».
const HIDDEN_FIELDS: {
  key: "contactPhone" | "contactName" | "orgName" | "invoice1C" | "serialNumber" | "configuration" | "defectNotes";
  label: string;
  phone?: boolean;
}[] = [
  { key: "contactPhone", label: "Тел.", phone: true },
  { key: "orgName", label: "Заказчик" },
  { key: "contactName", label: "Контакт" },
  { key: "invoice1C", label: "Заказ 1С" },
  { key: "serialNumber", label: "Серийник" },
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
  const visible = [...visibleTexts, String(m.number), formatOurNumber(m.ourNumber) ?? ""];
  if (visible.some((v) => v && highlightRanges(v, q).length > 0)) return null;
  for (const f of HIDDEN_FIELDS) {
    const value = m[f.key];
    if (!value) continue;
    const hit = f.phone
      ? phoneHighlightRanges(value, q).length > 0 || highlightRanges(value, q).length > 0
      : highlightRanges(value, q).length > 0;
    if (hit) return { label: f.label, text: value, phone: f.phone ?? false };
  }
  return null;
}
