// Выгрузка «Сводки по водителям» в CSV: заголовки, строка на водителя, строка «Итого».
// Чистая функция над DTO — без доступа к БД, тестируется. Среднее на объекте — в минутах
// (число для Excel); пустое значение, если данных нет.
import { toCsv } from "./csv";
import type { SummaryOverview } from "./summary-dto";

export const SUMMARY_CSV_HEADERS = [
  "Водитель",
  "Выполнено",
  "Ремонты",
  "Доставки",
  "Опоздания",
  "Невыполненные точки",
  "Отмены",
  "Переносы",
  "Среднее на объекте, мин",
];

export function buildSummaryCsv(overview: SummaryOverview): string {
  const rows = [
    SUMMARY_CSV_HEADERS,
    ...overview.drivers.map((d) => [
      d.driverName,
      d.doneCount,
      d.repairCount,
      d.deliveryCount,
      d.lateCount,
      d.missedStopCount,
      d.cancelledCount,
      d.rescheduledCount,
      d.avgOnSiteMinutes ?? "",
    ]),
    [
      "Итого",
      overview.totals.doneCount,
      overview.totals.repairCount,
      overview.totals.deliveryCount,
      overview.totals.lateCount,
      overview.totals.missedStopCount,
      overview.totals.cancelledCount,
      overview.totals.rescheduledCount,
      overview.totals.avgOnSiteMinutes ?? "",
    ],
  ];
  return toCsv(rows);
}

/** Имя файла выгрузки: summary_<разрез>_<начало>_<конец>.csv. */
export function summaryFileName(overview: SummaryOverview): string {
  return `summary_${overview.granularity}_${overview.fromKey}_${overview.toKey}.csv`;
}
