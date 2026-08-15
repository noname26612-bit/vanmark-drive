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

/** Отображение учётного номера: «77-5» у своего железа, «К-5» у чужого. */
export function formatOurNumber(m: NumberedMachine): string | null {
  return formatMachineNumber(m);
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
    formatOurNumber(m),
    // «к5», «k-5» и прочие написания клиентского номера — человек ищет как набралось.
    ...machineNumberSearchVariants(m),
    MACHINE_STATUS_LABEL[m.status],
    MACHINE_CATEGORY_LABEL[m.category],
    // Подпись вида — только у ножей: «нож»/«роликовый» находит их, а слово «станок» не
    // превращается в запрос-пустышку, матчащий всю картотеку.
    !isHeadKind(m.kind) ? EQUIPMENT_KIND_LABEL[m.kind] : null,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
}

// Числовые «стога»: учётный номер (и как «5», и как «775» — чтобы находился запрос «77-5»), цифры
// № заказа 1С и серийника. Сквозной системный номер из поиска убран вместе с его показом (15.08.2026):
// искать по числу, которого человек больше нигде не видит, — только ложные совпадения.
function numberHaystacks(m: SearchableMachine): string[] {
  const out: string[] = [];
  const value = machineNumberValue(m);
  if (value !== null) {
    // «5» — сам номер; «775» — чтобы находился запрос «77-5» (дефис поиск не различает).
    out.push(String(value));
    if (m.category !== "CLIENT") out.push(`77${value}`);
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
  const visible = [...visibleTexts, formatOurNumber(m) ?? ""];
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
