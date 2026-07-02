import { describe, it, expect } from "vitest";
import { buildCarrierCsv, carrierFileName, CARRIER_CSV_HEADERS } from "./carrier-csv";
import type { CarrierSummary } from "./summary-dto";

const base: CarrierSummary = {
  granularity: "week",
  anchor: "2026-07-01",
  fromKey: "2026-06-29",
  toKey: "2026-07-05",
  taskCount: 2,
  pricedCount: 1,
  totalCost: 7000,
  avgCost: 7000,
  tasks: [
    { taskId: "t1", number: 501, title: "Доставка ЛБМ", dateKey: "2026-06-30", cost: 7000, driverName: "Внешний перевозчик" },
    { taskId: "t2", number: 502, title: "Забор из ТК", dateKey: "2026-07-01", cost: null, driverName: "Внешний перевозчик" },
  ],
};

describe("carrier-csv", () => {
  it("строка на задачу + «Итого»; непроставленная стоимость — пусто", () => {
    const csv = buildCarrierCsv(base);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain(CARRIER_CSV_HEADERS[0]);
    expect(lines).toHaveLength(1 + 2 + 1); // заголовок + 2 задачи + итого
    expect(lines[1]).toContain("Доставка ЛБМ");
    expect(lines[1]).toContain("7000");
    expect(lines[3]).toContain("Итого");
    expect(lines[3]).toContain("7000");
  });

  it("имя файла по разрезу и окну", () => {
    expect(carrierFileName(base)).toBe("carrier_week_2026-06-29_2026-07-05.csv");
  });
});
