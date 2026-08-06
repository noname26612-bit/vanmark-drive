// Умный клиентский поиск по задачам (доска «Сегодня», «Планирование»; подсветка — везде).
// Движок разбора запроса, матчинга и подсветки — общий (`src/lib/search-core.ts`), здесь только
// предметная часть: какие поля задачи ищем и что показывать в сниппете «почему нашлось».
// Реэкспорт примитивов сохранён — экраны импортируют их отсюда с 20.07.2026.
import {
  digitsWithMap,
  highlightRanges,
  matchesFields,
  normalizeText,
  parseQuery,
  phoneHighlightRanges,
  type MatchRange,
  type ParsedQuery,
} from "./search-core";

export {
  digitsWithMap,
  highlightRanges,
  normalizeText,
  parseQuery,
  phoneHighlightRanges,
  type MatchRange,
  type ParsedQuery,
};

export type SearchableTask = {
  number: number;
  title: string;
  address: string | null;
  description?: string | null;
  equipment?: string | null;
  orgName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  invoiceNumber?: string | null;
  type?: { name: string } | null;
  assignee?: { name: string } | null;
  coDriver?: { name: string } | null; // напарник (появится в задаче «двое водителей»)
};

// Текстовые поля задачи для матчинга (телефон отдельно — он сравнивается по цифрам).
function textFields(t: SearchableTask): string[] {
  return [
    t.title,
    t.address,
    t.orgName,
    t.contactName,
    t.invoiceNumber,
    t.description,
    t.equipment,
    t.type?.name,
    t.assignee?.name,
    t.coDriver?.name,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
}

// Цифровой токен (≥2 цифр) матчится с № заявки и № счёта по вхождению цифр.
function numberHaystacks(t: SearchableTask): string[] {
  const out = [String(t.number)];
  if (t.invoiceNumber) {
    const { digits } = digitsWithMap(t.invoiceNumber);
    if (digits) out.push(digits);
  }
  return out;
}

/** Подходит ли задача под запрос: каждый токен обязан найтись хотя бы в одном поле;
 * числовой запрос («+7 926…», «№615») матчится склейкой цифр по телефону/№ заявки/№ счёта. */
export function taskMatches(t: SearchableTask, q: ParsedQuery): boolean {
  return matchesFields(q, textFields(t), numberHaystacks(t), t.contactPhone);
}

// --- Сниппет «почему нашлось» -----------------------------------------------------------------
// Карточка на доске показывает №, название и адрес. Если совпадение только в скрытом поле
// (телефон/контакт/организация/счёт/описание/оборудование) — показываем строчку-сниппет.

export type HiddenMatch = {
  label: string; // короткая подпись поля («Тел.», «Орг.», …)
  text: string; // исходное значение поля
  phone: boolean; // подсвечивать по цифрам (телефон), не по тексту
};

const HIDDEN_FIELDS: {
  key: "contactPhone" | "contactName" | "orgName" | "invoiceNumber" | "description" | "equipment";
  label: string;
  phone?: boolean;
}[] = [
  { key: "contactPhone", label: "Тел.", phone: true },
  { key: "contactName", label: "Контакт" },
  { key: "orgName", label: "Орг." },
  { key: "invoiceNumber", label: "Счёт" },
  { key: "description", label: "Описание" },
  { key: "equipment", label: "Обор." },
];

/** Первое скрытое поле карточки, в котором есть совпадение (для сниппета). Поля, видимые на
 * карточке, передаются в visibleTexts — если совпадение уже видно, сниппет не нужен. */
export function firstHiddenMatch(
  t: SearchableTask,
  q: ParsedQuery,
  visibleTexts: string[],
): HiddenMatch | null {
  if (!q.active) return null;
  const visibleHit =
    visibleTexts.some((v) => highlightRanges(v, q).length > 0) ||
    highlightRanges(String(t.number), q).length > 0;
  if (visibleHit) return null;
  for (const f of HIDDEN_FIELDS) {
    const value = t[f.key];
    if (!value) continue;
    const hit = f.phone
      ? phoneHighlightRanges(value, q).length > 0 || highlightRanges(value, q).length > 0
      : highlightRanges(value, q).length > 0;
    if (hit) return { label: f.label, text: value, phone: f.phone ?? false };
  }
  return null;
}
