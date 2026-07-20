// Выгрузка «Сводки по водителям» в CSV: заголовки, строка на водителя, строка «Итого».
// Чистая функция над DTO — без доступа к БД, тестируется. Времена — в минутах (числа для Excel);
// пустое значение, если данных нет. Сводка v2 (02.07): «Ремонты/Доставки» убраны (решение Артёма —
// разбивка по типам не нужна нигде, включая CSV); добавлены смены/загрузка/план/факт/зафиксированный
// простой. Рублёвая цена простоя — только в выгрузке админа (overview.payrollVisible; №10).
import { toCsv } from "./csv";
import type { SummaryOverview } from "./summary-dto";

export const SUMMARY_CSV_HEADERS = [
  "Водитель",
  "Выполнено",
  "В паре",
  "Поздние смены",
  "Невыполненные точки",
  "Отмены",
  "Переносы",
  "Среднее на задаче, мин",
  "Отработано, мин",
  "Смены, мин",
  "Простой, мин",
  "Загрузка, %",
  "План, мин",
  "Факт, мин",
  "Простой (пометки), мин",
];

const MONEY_HEADERS = ["Цена простоя, ₽"];

export function buildSummaryCsv(overview: SummaryOverview): string {
  const withMoney = overview.payrollVisible;
  const headers = withMoney ? [...SUMMARY_CSV_HEADERS, ...MONEY_HEADERS] : SUMMARY_CSV_HEADERS;
  const rows = [
    headers,
    ...overview.drivers.map((d) => {
      const base: (string | number)[] = [
        d.driverName,
        d.doneCount,
        d.pairDoneCount,
        d.lateCount,
        d.missedStopCount,
        d.cancelledCount,
        d.rescheduledCount,
        d.avgOnSiteMinutes ?? "",
        d.workedMinutes,
        d.shiftMinutes,
        d.idleMinutes,
        d.loadPercent ?? "",
        d.planMinutes,
        d.factMinutes,
        d.idleNotedMinutes,
      ];
      // Пер-водительскую цену простоя не отдаём даже админу в строках (сервер её не считает по
      // водителям в overview) — рубль только итогом. Пустая ячейка в строке.
      return withMoney ? [...base, ""] : base;
    }),
    (() => {
      const t = overview.totals;
      const base: (string | number)[] = [
        "Итого",
        t.doneCount,
        "", // «В паре» в итогах не суммируем: это участия, не отдельные задачи (удвоения нет)
        t.lateCount,
        t.missedStopCount,
        t.cancelledCount,
        t.rescheduledCount,
        t.avgOnSiteMinutes ?? "",
        t.workedMinutes,
        t.shiftMinutes,
        t.idleMinutes,
        t.loadPercent ?? "",
        t.planMinutes,
        t.factMinutes,
        t.idleNotedMinutes,
      ];
      return withMoney ? [...base, overview.money.idleCost ?? ""] : base;
    })(),
  ];
  return toCsv(rows);
}

/** Имя файла выгрузки: summary_<разрез>_<начало>_<конец>.csv. */
export function summaryFileName(overview: SummaryOverview): string {
  return `summary_${overview.granularity}_${overview.fromKey}_${overview.toKey}.csv`;
}
