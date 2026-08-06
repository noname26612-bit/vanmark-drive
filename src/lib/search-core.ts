// Движок умного поиска: разбор запроса, матчинг и подсветка. Чистый модуль без React/Prisma —
// работает и в браузере, и в Node, покрыт юнит-тестами.
//
// Выделен из task-search.ts (20.07.2026) при появлении второго потребителя — картотеки станков
// (05.08.2026, PRD §16.5). Дублировать эти 150 строк было нельзя: тонкости (раскладка, 8↔7,
// length-preserving нормализация ради индексов подсветки) неизбежно разъехались бы между копиями.
// Предметная часть — какие поля искать — живёт у каждого потребителя своя (task-search / machine-search).
//
// Принципы (ранжирование в духе match-sorter — детерминированное, без fuzzy-магии):
// - запрос бьётся на токены; объект подходит, если КАЖДЫЙ токен найден хотя бы в одном поле (AND);
// - сравнение регистронезависимое, ё=е; телефоны и номера сравниваются по цифрам (8 ≈ +7);
// - токен, набранный не в той раскладке («gjbcr» вместо «поиск»), пробуется в обеих раскладках;
// - нормализация СТРОГО посимвольная (длина сохраняется) — иначе индексы подсветки разъедутся.

export type Token = {
  variants: string[]; // текстовые варианты токена: как набрано + конвертация раскладки
  digits: string[]; // цифровые варианты (≥MIN_PHONE_DIGITS) для телефона: как есть, 8↔7
};

// «Числовой» запрос — без единой буквы («+7 926 123-45-67», «№ 615», «948»). Такой запрос —
// это номер (телефона/заявки/счёта), набранный целиком: матчим склейку ВСЕХ его цифр, а не
// пословные токены (иначе «+7» отдельным токеном ломал бы копипасту телефона из карточки).
export type NumericQuery = { digits: string; phoneVariants: string[] };

export type ParsedQuery = {
  active: boolean; // есть ли непустой запрос
  tokens: Token[];
  numeric: NumericQuery | null;
};

// Пороги: короткие цифры не матчим по телефону (шум), 1-буквенные токены не конвертируем раскладкой.
export const MIN_PHONE_DIGITS = 3;
export const MIN_NUMBER_DIGITS = 2; // для № заявки и № счёта достаточно двух цифр
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

/**
 * Общий матчер: объект описан списком текстовых полей, списком «числовых стогов» (номера, где
 * достаточно 2 цифр) и телефоном. Предметная логика — какие поля куда отнести — у потребителя.
 */
export function matchesFields(
  q: ParsedQuery,
  fieldsRaw: string[],
  numberHaystacks: string[],
  phoneRaw: string | null | undefined,
): boolean {
  if (!q.active) return true;
  const phoneDigits = phoneRaw ? digitsWithMap(phoneRaw).digits : "";

  if (q.numeric) {
    const { digits, phoneVariants: pv } = q.numeric;
    if (digits.length >= MIN_NUMBER_DIGITS) {
      if (numberHaystacks.some((n) => n.includes(digits))) return true;
      // Цифры бывают и в тексте («ЛБМ 200», «0,7 мм») — числовой запрос ищет и там.
      if (fieldsRaw.some((f) => normalizeText(f).includes(digits))) return true;
    }
    return phoneDigits.length > 0 && pv.some((d) => phoneDigits.includes(d));
  }

  const fields = fieldsRaw.map(normalizeText);
  return q.tokens.every((token) => {
    // 1) обычное текстовое вхождение любого варианта токена
    if (token.variants.some((v) => fields.some((f) => f.includes(v)))) return true;
    // 2) цифры токена — по номерам (порог мягче) и по телефону (жёстче, с 8↔7)
    const { digits } = digitsWithMap(token.variants[0]);
    if (digits.length >= MIN_NUMBER_DIGITS && numberHaystacks.some((n) => n.includes(digits))) return true;
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
