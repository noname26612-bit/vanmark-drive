// Разбор поля «Телефон» заявки в список отдельных номеров (03.08.2026).
// Чистый модуль без React/Prisma: покрывается юнит-тестами, работает и в браузере, и в Node.
//
// Зачем: contactPhone — одна свободная строка, Милена нередко пишет туда 2-3 номера
// («+7 926 111-22-33, 8 916 444-55-66»). Раньше водительский UI подставлял всю строку в
// href="tel:…" целиком — телефон получал в поле набора мусор и позвонить было нельзя.
// Теперь номера разбираются по отдельности: каждый — своя строка и своя ссылка.
//
// Принципы:
// - режем только по ЯВНЫМ разделителям (запятая/точка с запятой/перенос/слэш/вертикальная черта);
//   пробел разделителем НЕ считаем — «8 926 123 45 67» это один номер;
// - слипшиеся без разделителя номера («89261234567 89167654321») режем только когда цифр
//   заведомо больше, чем в одном номере (порог GLUED_MIN) — иначе «84951234567» разъехался бы надвое;
// - href собираем ТОЛЬКО из цифр, ведущего «+» и запятой перед добавочным (пауза набора) —
//   это и есть санитизация: что бы ни лежало в строке, в атрибут попадут лишь безопасные символы.

export type ParsedPhone = {
  /** Исходный фрагмент строки (для отладки и фолбэка показа). */
  raw: string;
  /** Нормализованные цифры без «+»: 79261234567. */
  digits: string;
  /** Иностранный номер: не приводим к российскому виду, набираем с «+». */
  intl: boolean;
  /** Готовый href: «tel:+79261234567» или «tel:+74951234567,1234». */
  href: string;
  /** Для показа: «+7 926 123-45-67». */
  display: string;
  /** Добавочный: «1234» из «доб. 1234». */
  ext: string | null;
  /** Подпись рядом с номером: «Иван», «склад». */
  label: string | null;
};

// Явные разделители номеров. Пробел сюда НЕ входит осознанно (см. шапку).
const SEPARATORS = /[,;|/\n\r•]+/;

// Минимум цифр, чтобы считать фрагмент номером (короткий городской «2-34-56» — 5 цифр).
const MIN_DIGITS = 4;

// Порог «здесь точно больше одного номера»: 11-значный + 10-значный минимум. Ниже порога
// строка считается ОДНИМ номером — защита от разрезания длинных городских вроде 84951234567.
const GLUED_MIN = 20;

// Больше пяти номеров в одном поле не бывает — остальное считаем мусором и не показываем.
const MAX_PHONES = 5;

// Слова-маркеры, которые не должны попасть в подпись к номеру.
const LABEL_STOPWORDS = new Set([
  "тел",
  "телефон",
  "тлф",
  "моб",
  "мобильный",
  "сот",
  "сотовый",
  "номер",
  "доб",
  "добавочный",
  "вн",
  "ext",
  "phone",
  "tel",
]);

// Добавочный в хвосте фрагмента: «доб. 1234», «вн 45», «ext 7», «#12».
const EXT_RE = /(?:доб(?:ав(?:очный)?)?|вн(?:утр)?|ext|x|#)\s*\.?\s*(\d{1,6})\s*$/i;

// Подпись в скобках: берём только если внутри есть буква — «(926)» это код региона, не подпись.
const LABEL_PAREN_RE = /\(([^)]*[A-Za-zА-Яа-яЁё][^)]*)\)/;

// Телефоноподобная последовательность: старт с «+» или цифры, дальше цифры и разделители внутри
// номера. Буква обрывает последовательность (мусор рядом не попадёт в набор), «+» не продолжает
// её — значит слепленные «+7926…+7916…» разойдутся на два совпадения.
const PHONE_CHUNK_RE = /[+\d][\d\s\-().]*/g;

/** Только цифры строки. */
function onlyDigits(s: string): string {
  let out = "";
  for (const ch of s) if (ch >= "0" && ch <= "9") out += ch;
  return out;
}

/**
 * Разрезать склейку цифр на отдельные номера. Режем, пока цифр заведомо хватает на два номера:
 * ведущий 7/8 → откусываем 11 цифр, ведущая 9 (номер без кода страны) → 10, иначе 11.
 */
function splitGluedDigits(digits: string): string[] {
  const out: string[] = [];
  let rest = digits;
  while (rest.length >= GLUED_MIN) {
    const head = rest[0];
    const take = head === "9" ? 10 : 11;
    out.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  if (rest.length >= MIN_DIGITS) out.push(rest);
  return out;
}

/**
 * Привести цифры к каноничному виду. Российские: 8XXXXXXXXXX → 7XXXXXXXXXX, 10 цифр → +7.
 * Всё, что длиннее 11 цифр или пришло с «+» и не похоже на российский, считаем иностранным.
 */
function normalizeDigits(digits: string, hadPlus: boolean): { digits: string; intl: boolean } {
  if (hadPlus) {
    if (digits.length === 11 && digits.startsWith("7")) return { digits, intl: false };
    return { digits, intl: true };
  }
  if (digits.length === 11 && digits.startsWith("8")) return { digits: `7${digits.slice(1)}`, intl: false };
  if (digits.length === 11 && digits.startsWith("7")) return { digits, intl: false };
  if (digits.length === 10) return { digits: `7${digits}`, intl: false };
  if (digits.length > 11) return { digits, intl: true };
  return { digits, intl: false }; // короткий городской — набирается как есть
}

/** Российский он или нет — набирать ли с ведущим «+». */
function needsPlus(digits: string, intl: boolean): boolean {
  return intl || (digits.length === 11 && digits.startsWith("7"));
}

/**
 * Безопасный href для звонка: «tel:» + только цифры, ведущий «+» и «,добавочный».
 * Запятая — стандартная пауза набора (Android/iOS донабирают добавочный после соединения).
 */
export function telHref(digits: string, opts?: { intl?: boolean; ext?: string | null }): string {
  const clean = onlyDigits(digits);
  if (!clean) return "";
  const core = needsPlus(clean, opts?.intl ?? false) ? `+${clean}` : clean;
  const ext = onlyDigits(opts?.ext ?? "");
  return `tel:${core}${ext ? `,${ext}` : ""}`;
}

/** Показ номера: «+7 926 123-45-67», «123-45-67», иностранный — «+380671234567». */
export function formatPhoneRu(digits: string, intl = false): string {
  const d = onlyDigits(digits);
  if (!d) return "";
  if (!intl && d.length === 11 && d.startsWith("7")) {
    return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  if (!intl && d.length === 7) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 7)}`;
  if (!intl && d.length === 6) return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
  return intl ? `+${d}` : d;
}

/** Достать подпись («Иван», «склад») из фрагмента; служебные слова («тел», «доб») подписью не считаем. */
function pickLabel(fragment: string): string | null {
  const words = fragment.match(/[A-Za-zА-Яа-яЁё]{2,}/g);
  if (!words) return null;
  const useful = words.filter((w) => !LABEL_STOPWORDS.has(w.toLowerCase()));
  if (useful.length === 0) return null;
  return useful.join(" ").slice(0, 40);
}

/** Разобрать один фрагмент (уже отрезанный по разделителям) в один или несколько номеров. */
function parseFragment(fragment: string): ParsedPhone[] {
  let rest = fragment;
  let label: string | null = null;

  // 1. Подпись в скобках — вырезаем вместе со скобками.
  const paren = LABEL_PAREN_RE.exec(rest);
  if (paren) {
    label = paren[1].trim().slice(0, 40) || null;
    rest = rest.replace(LABEL_PAREN_RE, " ");
  }

  // 2. Добавочный в хвосте.
  let ext: string | null = null;
  const extMatch = EXT_RE.exec(rest);
  if (extMatch) {
    ext = extMatch[1];
    rest = rest.slice(0, extMatch.index);
  }

  // 3. Подпись из оставшегося текста («Иван +7 926 …»).
  if (!label) label = pickLabel(rest);

  // 4. Вырезаем телефоноподобные последовательности: цифры и разделители внутри номера.
  // Буквы обрывают последовательность — «+7 926 123-45-67 alert(1)» не приклеит к номеру
  // постороннюю единицу. «+» не входит в продолжение, поэтому «+7926…+7916…» распадётся сам.
  const chunks = rest.match(PHONE_CHUNK_RE) ?? [];

  const out: ParsedPhone[] = [];
  for (const chunk of chunks) {
    const hadPlus = chunk.trimStart().startsWith("+");
    const digits = onlyDigits(chunk);
    if (digits.length < MIN_DIGITS) continue;
    const pieces = splitGluedDigits(digits);
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const norm = normalizeDigits(piece, hadPlus && i === 0);
      out.push({
        raw: fragment.trim(),
        digits: norm.digits,
        intl: norm.intl,
        href: telHref(norm.digits, { intl: norm.intl, ext }),
        display: formatPhoneRu(norm.digits, norm.intl),
        ext,
        label,
      });
    }
  }
  return out;
}

/**
 * Разобрать свободную строку телефона(ов) в список номеров. Пустая строка или строка без цифр → [].
 * Дубли схлопываются, количество ограничено MAX_PHONES.
 */
export function parsePhones(raw: string | null | undefined): ParsedPhone[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const fragments = trimmed.split(SEPARATORS);
  const out: ParsedPhone[] = [];
  const seen = new Set<string>();

  for (const fragment of fragments) {
    if (!fragment.trim()) continue;
    // Хвост вида «доб. 5» отдельным фрагментом — приклеиваем к предыдущему номеру.
    if (onlyDigits(fragment).length < MIN_DIGITS) {
      const tail = EXT_RE.exec(fragment.trim());
      const last = out[out.length - 1];
      if (tail && last && !last.ext) {
        last.ext = tail[1];
        last.href = telHref(last.digits, { intl: last.intl, ext: last.ext });
      }
      continue;
    }
    for (const parsed of parseFragment(fragment)) {
      const key = `${parsed.digits}|${parsed.ext ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed);
      if (out.length >= MAX_PHONES) return out;
    }
  }
  return out;
}
