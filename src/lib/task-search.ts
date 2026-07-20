// Умный клиентский поиск по задачам (доска «Сегодня», «Планирование»; подсветка — везде).
// Чистый модуль без React/Prisma: покрывается юнит-тестами, работает и в браузере, и в Node.
//
// Принципы (ранжирование в духе match-sorter — детерминированное, без fuzzy-магии):
// - запрос бьётся на токены; задача подходит, если КАЖДЫЙ токен найден хотя бы в одном поле (AND);
// - сравнение регистронезависимое, ё=е; телефоны и номера сравниваются по цифрам (8 ≈ +7);
// - токен, набранный не в той раскладке («gjbcr» вместо «поиск»), пробуется в обеих раскладках;
// - нормализация СТРОГО посимвольная (длина сохраняется) — иначе индексы подсветки разъедутся.

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

type Token = {
  variants: string[]; // текстовые варианты токена: как набрано + конвертация раскладки
  digits: string[]; // цифровые варианты (≥MIN_PHONE_DIGITS) для телефона: как есть, 8↔7
};

// «Числовой» запрос — без единой буквы («+7 926 123-45-67», «№ 615», «948»). Такой запрос —
// это номер (телефона/заявки/счёта), набранный целиком: матчим склейку ВСЕХ его цифр, а не
// пословные токены (иначе «+7» отдельным токеном ломал бы копипасту телефона из карточки).
type NumericQuery = { digits: string; phoneVariants: string[] };

export type ParsedQuery = {
  active: boolean; // есть ли непустой запрос
  tokens: Token[];
  numeric: NumericQuery | null;
};

// Пороги: короткие цифры не матчим по телефону (шум), 1-буквенные токены не конвертируем раскладкой.
const MIN_PHONE_DIGITS = 3;
const MIN_NUMBER_DIGITS = 2; // для № заявки и № счёта достаточно двух цифр
const MIN_LAYOUT_LEN = 2;

// Соответствие клавиш QWERTY ↔ ЙЦУКЕН (стандартная русская раскладка Windows/mac).
const QWERTY = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const YCUKEN = "йцукенгшщзхъфывапролджэячсмитьбюё";

const toRu = new Map<string, string>();
const toEn = new Map<string, string>();
for (let i = 0; i < QWERTY.length; i++) {
  toRu.set(QWERTY[i], YCUKEN[i]);
  toEn.set(YCUKEN[i], QWERTY[i]);
}

/** Посимвольная нормализация: lowercase + ё→е. Длина строки сохраняется (важно для подсветки). */
export function normalizeText(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) out += ch === "ё" ? "е" : ch;
  return out;
}

// Конвертация раскладки посимвольно; символы вне карты остаются как есть.
function convertLayout(s: string, map: Map<string, string>): string {
  let out = "";
  for (const ch of s) out += map.get(ch) ?? ch;
  return out;
}

/** Цифры строки + карта «индекс цифры → индекс символа в исходной строке» (для подсветки телефона). */
export function digitsWithMap(s: string): { digits: string; map: number[] } {
  let digits = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= "0" && ch <= "9") {
      digits += ch;
      map.push(i);
    }
  }
  return { digits, map };
}

// Российские номера: 8 XXX… и +7 XXX… — один и тот же телефон. Даём оба цифровых варианта.
function phoneVariants(digits: string): string[] {
  const out = [digits];
  if (digits.startsWith("8")) out.push(`7${digits.slice(1)}`);
  else if (digits.startsWith("7")) out.push(`8${digits.slice(1)}`);
  return out;
}

/** Разбор запроса на токены с вариантами. Пустой/пробельный запрос → active:false. */
export function parseQuery(raw: string): ParsedQuery {
  const norm = normalizeText(raw).trim();
  if (!norm) return { active: false, tokens: [], numeric: null };

  // Запрос без букв («+7 926 123-45-67», «№ 615») — это один номер: цифры склеиваются целиком.
  if (!/[a-zа-я]/.test(norm)) {
    const { digits } = digitsWithMap(norm);
    if (!digits) return { active: false, tokens: [], numeric: null }; // одна пунктуация — не запрос
    return {
      active: true,
      tokens: [],
      numeric: { digits, phoneVariants: digits.length >= MIN_PHONE_DIGITS ? phoneVariants(digits) : [] },
    };
  }

  const tokens: Token[] = norm
    .split(/\s+/)
    .filter((w) => /[0-9a-zа-я]/.test(w)) // токены из одной пунктуации («+», «-») — шум
    .map((word) => {
      const variants = new Set<string>([word]);
      if (word.length >= MIN_LAYOUT_LEN) {
        const ru = convertLayout(word, toRu);
        const en = convertLayout(word, toEn);
        if (ru !== word) variants.add(ru);
        if (en !== word) variants.add(en);
      }
      const { digits } = digitsWithMap(word);
      return {
        variants: [...variants],
        digits: digits.length >= MIN_PHONE_DIGITS ? phoneVariants(digits) : [],
      };
    });

  return { active: true, tokens, numeric: null };
}

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
  if (!q.active) return true;
  const phoneDigits = t.contactPhone ? digitsWithMap(t.contactPhone).digits : "";

  if (q.numeric) {
    const { digits, phoneVariants: pv } = q.numeric;
    if (digits.length >= MIN_NUMBER_DIGITS) {
      if (numberHaystacks(t).some((n) => n.includes(digits))) return true;
      // Цифры бывают и в тексте («ЛБМ 200», «0,7 мм») — числовой запрос ищет и там.
      if (textFields(t).some((f) => normalizeText(f).includes(digits))) return true;
    }
    return phoneDigits.length > 0 && pv.some((d) => phoneDigits.includes(d));
  }

  const fields = textFields(t).map(normalizeText);
  const numbers = numberHaystacks(t);
  return q.tokens.every((token) => {
    // 1) обычное текстовое вхождение любого варианта токена
    if (token.variants.some((v) => fields.some((f) => f.includes(v)))) return true;
    // 2) цифры токена — по № заявки / № счёта (порог мягче) и по телефону (жёстче, с 8↔7)
    const { digits } = digitsWithMap(token.variants[0]);
    if (digits.length >= MIN_NUMBER_DIGITS && numbers.some((n) => n.includes(digits))) return true;
    if (phoneDigits && token.digits.some((d) => phoneDigits.includes(d))) return true;
    return false;
  });
}

export type MatchRange = { start: number; end: number }; // [start, end) в ИСХОДНОЙ строке

// Слить пересекающиеся/смежные диапазоны, отсортировать.
function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: MatchRange[] = [sorted[0]];
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/** Диапазоны совпадений токенов в тексте (для <mark>). Работает по нормализованной копии,
 * индексы валидны для исходной строки (нормализация length-preserving). */
export function highlightRanges(text: string, q: ParsedQuery): MatchRange[] {
  if (!q.active || !text) return [];
  const hay = normalizeText(text);
  const ranges: MatchRange[] = [];
  // Числовой запрос: подсвечиваем вхождение цифр в тексте («№615» найдёт «615» в названии/счёте).
  if (q.numeric) {
    const { digits } = q.numeric;
    if (digits.length >= MIN_NUMBER_DIGITS) {
      let idx = hay.indexOf(digits);
      while (idx !== -1) {
        ranges.push({ start: idx, end: idx + digits.length });
        idx = hay.indexOf(digits, idx + 1);
      }
    }
    return mergeRanges(ranges);
  }
  for (const token of q.tokens) {
    for (const v of token.variants) {
      let idx = hay.indexOf(v);
      while (idx !== -1) {
        ranges.push({ start: idx, end: idx + v.length });
        idx = hay.indexOf(v, idx + 1);
      }
    }
    // Цифровые токены подсвечиваем и в текстовых полях, где цифры идут подряд («№615», счёт «948»).
    const { digits } = digitsWithMap(token.variants[0]);
    if (digits.length >= MIN_NUMBER_DIGITS && !token.variants.includes(digits)) {
      let idx = hay.indexOf(digits);
      while (idx !== -1) {
        ranges.push({ start: idx, end: idx + digits.length });
        idx = hay.indexOf(digits, idx + 1);
      }
    }
  }
  return mergeRanges(ranges);
}

/** Диапазоны совпадений в телефоне: цифры запроса ищутся в цифрах номера (8≈+7),
 * подсветка растягивается на исходное написание («+7 (926) 123-45-67»). */
export function phoneHighlightRanges(phone: string, q: ParsedQuery): MatchRange[] {
  if (!q.active || !phone) return [];
  const { digits, map } = digitsWithMap(phone);
  if (!digits) return [];
  const ranges: MatchRange[] = [];
  const needles = q.numeric ? q.numeric.phoneVariants : q.tokens.flatMap((t) => t.digits);
  for (const d of needles) {
    let idx = digits.indexOf(d);
    while (idx !== -1) {
      ranges.push({ start: map[idx], end: map[idx + d.length - 1] + 1 });
      idx = digits.indexOf(d, idx + 1);
    }
  }
  return mergeRanges(ranges);
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
