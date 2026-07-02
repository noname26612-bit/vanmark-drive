// Выгрузка затрат на внешнего перевозчика в CSV (этап 3, 02.07): строка на задачу + «Итого».
// Чистая функция над DTO — без доступа к БД, тестируется юнитом.
import { toCsv } from "./csv";
import type { CarrierSummary } from "./summary-dto";

export const CARRIER_CSV_HEADERS = ["Дата", "№", "Название", "Исполнитель", "Стоимость, ₽"];

export function buildCarrierCsv(summary: CarrierSummary): string {
  const rows = [
    CARRIER_CSV_HEADERS,
    ...summary.tasks.map((t) => [t.dateKey, t.number, t.title, t.driverName, t.cost ?? ""]),
    ["Итого", "", "", "", summary.totalCost],
  ];
  return toCsv(rows);
}

/** Имя файла выгрузки: carrier_<разрез>_<начало>_<конец>.csv. */
export function carrierFileName(summary: CarrierSummary): string {
  return `carrier_${summary.granularity}_${summary.fromKey}_${summary.toKey}.csv`;
}
