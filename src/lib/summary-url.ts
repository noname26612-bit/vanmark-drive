// Период Сводки в адресе страницы (22.08.2026): `?g=week&d=2026-08-17`.
//
// ЗАЧЕМ. До сих пор разрез и якорь жили только в состоянии компонента: перезагрузка возвращала
// «неделя, сегодня», а показать коллеге конкретный период можно было только словами. Теперь ссылку
// на «август 2026» можно отправить, а F5 не сбрасывает то, что диспетчер уже открыл.
//
// Разбор — чистая функция: сервер читает searchParams при рендере страницы, клиент дописывает
// адрес через history.replaceState. Мусор в параметрах — не ошибка: показываем период по умолчанию
// (ссылку могли обрезать или поправить руками), падать 500 из-за `?g=zzz` не за что.
import { isGranularity, normalizeAnchor, type Granularity } from "@/domain/summary";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Существует ли такой день на самом деле. Одной регулярки мало: `2026-02-31` ей подходит, а движок
 * дат молча перекатывает такую строку в 3 марта — период уехал бы на другой месяц без единой ошибки.
 */
function isRealDateKey(d: string): boolean {
  if (!DATE_KEY.test(d)) return false;
  const parsed = new Date(`${d}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
}

export type SummaryParams = {
  granularity: Granularity;
  /** Якорь окна: начало недели/месяца (то, что уходит в запрос и в адрес). */
  anchor: string;
  /**
   * ВЫБРАННЫЙ день — до подтягивания к началу окна. Клиент держит именно его: иначе переключение
   * «Неделя → День» на текущей неделе показывало бы понедельник, а не сегодня (окно нормализовано,
   * а исходный день потерян).
   */
  day: string;
};

/**
 * `{g,d}` из адреса → период. `todayKey` — сегодняшний московский день (его считает вызывающий:
 * на сервере из KPI_TZ, в тестах — фиксированный).
 */
export function parseSummaryParams(
  params: { g?: string | string[]; d?: string | string[] },
  todayKey: string,
): SummaryParams {
  const g = first(params.g);
  const d = first(params.d);
  const granularity: Granularity = g && isGranularity(g) ? g : "week";
  const raw = d && isRealDateKey(d) ? d : todayKey;
  // normalizeAnchor валидирует ключ ещё раз и подтягивает якорь к началу окна (понедельник/1-е).
  // Невалидную дату из адреса он бы отверг исключением — до него доходит только проверенная.
  return { granularity, anchor: normalizeAnchor(granularity, raw), day: raw };
}

/** Адрес Сводки для заданного периода — то, что уходит в history.replaceState. */
export function summaryUrl(granularity: Granularity, anchor: string): string {
  return `/summary?g=${granularity}&d=${anchor}`;
}

/** Повторяющийся параметр (`?g=day&g=week`) — берём первый, как это делает и сам Next. */
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
