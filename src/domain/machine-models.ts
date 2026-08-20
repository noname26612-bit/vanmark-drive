// Справочник моделей станков и подбор подсказок для поля «Модель» (PRD §16.5, решение Артёма
// 07.08.2026). Чистый модуль без React/Prisma — используется клиентским комбобоксом и юнит-тестами.
//
// Почему здесь есть свой транслит: движок поиска (src/lib/search-core.ts) умеет только раскладку
// клавиатуры (QWERTY↔ЙЦУКЕН), а Максим ищет модель «по-русски буквами» — «лбм» должно находить
// «Sorex LBM 200», «профи» ищут и как «profi». Раскладка тут не помогает («лбм» на латинских
// клавишах — «k,<»), нужна транслитерация. Она нарочно живёт рядом со справочником, а не в
// search-core: для поиска по живым карточкам транслит дал бы шумные ложные совпадения, а для
// подбора из 25 названий лишняя подсказка безвредна.
//
// Пополнение списка — правка одной строки. Редактируемый экран справочника сознательно не заводим
// (CLAUDE.md «не переусложнять»); реально введённые названия и так попадают в подсказки из БД.
import { matchesFields, parseQuery } from "@/lib/search-core";

/** Базовые модели — дословно от Артёма (07.08.2026), порядок авторский. */
export const MACHINE_MODELS: readonly string[] = [
  "Van Mark MetalMaster 20 (MM)",
  "Van Mark Industrial MetalMaster (IM)",
  "Van Mark Industrial TrimMaster (IT)",
  "Van Mark II (TrimMaster)",
  "Tapco MAX 20",
  "Tapco SuperMax",
  "Tapco Pro - 14",
  "Tapco Pro - 19",
  "Sorex LBM 200",
  "Sorex LBM 250",
  "Sorex LBM 300",
  "Профи 2000",
  "Профи 2500",
  "Профи 3000",
  "Mazanek ZGR",
  "Schechtl LBX",
  "Decker X5",
  "Decker",
  "LBA 2007 (2м)",
  "LBA 2507 (2.5м)",
  "LBA 3007 (3м)",
  "LBA 2015 (2.5м)",
  "LBA 2510 (2.5м)",
  "LBA 3010 (3м)",
  "Prod Masz",
] as const;

// Диграфы важнее посимвольной карты: «Schechtl» → «шехтл» (sch→ш, ch→х), «Decker» → «декер»
// (ck→к — по-русски удвоение не пишут), «Sorex» → «сорекс» (x→кс).
const LAT_DIGRAPHS: [string, string][] = [
  ["sch", "ш"],
  ["sh", "ш"],
  ["ch", "х"],
  ["ck", "к"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ya", "я"],
  ["yu", "ю"],
];

const LAT_SINGLE: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "дж",
  k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т",
  u: "у", v: "в", w: "в", x: "кс", y: "и", z: "з",
};

const CYR_SINGLE: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e",
  ю: "yu", я: "ya",
};

/** Латиница → «как это читают по-русски»: van mark → ван марк. Регистронезависимо (вход — lowercase). */
function latinToCyr(lower: string): string {
  let out = "";
  let i = 0;
  while (i < lower.length) {
    const pair = LAT_DIGRAPHS.find(([d]) => lower.startsWith(d, i));
    if (pair) {
      out += pair[1];
      i += pair[0].length;
      continue;
    }
    out += LAT_SINGLE[lower[i]] ?? lower[i];
    i += 1;
  }
  return out;
}

/** Кириллица → латиница: профи → profi. */
function cyrToLatin(lower: string): string {
  let out = "";
  for (const ch of lower) out += CYR_SINGLE[ch === "ё" ? "е" : ch] ?? ch;
  return out;
}

/**
 * «Стог» названия для матчинга: само название + его прочтения в обе стороны. Обе конвертации на
 * смешанных строках безвредны: чужие символы проходят как есть.
 */
export function modelHaystack(label: string): string[] {
  const lower = label.toLowerCase();
  const variants = new Set<string>([label, latinToCyr(lower), cyrToLatin(lower)]);
  return [...variants];
}

/**
 * Пул подсказок: базовые модели первыми в авторском порядке, затем реально введённые в картотеке
 * (из БД), которых нет среди базовых. Сравнение без регистра и лишних пробелов — «sorex lbm 200»
 * из БД не дублирует базовую строку.
 *
 * `suppressed` — названия, которые попросили не показывать (крестик в списке, 20.08.2026): в
 * карточки иногда заносят временное имя вроде «Хз ждём Михаила», и оно потом предлагается всем.
 * Скрывать можно и базовые строки справочника: раздел, где такой модели нет, не должен её видеть.
 */
export function modelSuggestionPool(
  dbModels: readonly string[],
  suppressed: readonly string[] = [],
): string[] {
  const hidden = new Set(suppressed.map((m) => m.trim().toLowerCase()));
  const seen = new Set(MACHINE_MODELS.map((m) => m.trim().toLowerCase()));
  const extra: string[] = [];
  for (const raw of dbModels) {
    const label = raw.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    extra.push(label);
  }
  extra.sort((a, b) => a.localeCompare(b, "ru"));
  return [...MACHINE_MODELS, ...extra].filter((m) => !hidden.has(m.trim().toLowerCase()));
}

/**
 * Подбор по вводу: часть слова, любая раскладка (search-core) и любой алфавит (транслит выше).
 * Пустой ввод возвращает весь пул — комбобокс показывает полный список по фокусу.
 */
export function filterModelSuggestions(pool: readonly string[], rawInput: string): string[] {
  const q = parseQuery(rawInput);
  if (!q.active) return [...pool];
  return pool.filter((label) => matchesFields(q, modelHaystack(label), [], null));
}
