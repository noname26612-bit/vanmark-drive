import { describe, it, expect } from "vitest";
import { parseSummaryParams, summaryUrl } from "./summary-url";

const TODAY = "2026-08-22"; // суббота

describe("summary-url: parseSummaryParams", () => {
  it("пустые параметры — неделя вокруг сегодня, якорь на понедельнике", () => {
    expect(parseSummaryParams({}, TODAY)).toEqual({
      granularity: "week",
      anchor: "2026-08-17",
      day: TODAY,
    });
  });

  it("разрез и дата из адреса читаются как есть", () => {
    expect(parseSummaryParams({ g: "day", d: "2026-07-04" }, TODAY)).toEqual({
      granularity: "day",
      anchor: "2026-07-04",
      day: "2026-07-04",
    });
  });

  it("месяц подтягивает якорь к первому числу, но выбранный день сохраняется", () => {
    // day нужен клиенту: переключение «Месяц → День» должно показать 19-е, а не 1-е.
    expect(parseSummaryParams({ g: "month", d: "2026-07-19" }, TODAY)).toEqual({
      granularity: "month",
      anchor: "2026-07-01",
      day: "2026-07-19",
    });
  });

  it("мусорный разрез — неделя по умолчанию, не ошибка", () => {
    expect(parseSummaryParams({ g: "zzz", d: "2026-07-04" }, TODAY).granularity).toBe("week");
  });

  it("мусорная и несуществующая дата — сегодня, не ошибка", () => {
    expect(parseSummaryParams({ g: "day", d: "zzz" }, TODAY).anchor).toBe(TODAY);
    expect(parseSummaryParams({ g: "day", d: "2026-02-31" }, TODAY).anchor).toBe(TODAY);
    expect(parseSummaryParams({ g: "day", d: "" }, TODAY).anchor).toBe(TODAY);
  });

  it("повторяющийся параметр — берём первый", () => {
    expect(parseSummaryParams({ g: ["month", "day"], d: ["2026-07-19"] }, TODAY)).toEqual({
      granularity: "month",
      anchor: "2026-07-01",
      day: "2026-07-19",
    });
  });
});

describe("summary-url: summaryUrl", () => {
  it("собирает адрес периода", () => {
    expect(summaryUrl("month", "2026-08-01")).toBe("/summary?g=month&d=2026-08-01");
  });

  it("адрес переживает круг «собрали → разобрали»", () => {
    const url = summaryUrl("day", "2026-08-22");
    const [g, d] = [url.match(/g=([^&]+)/)![1], url.match(/d=([^&]+)/)![1]];
    expect(parseSummaryParams({ g, d }, TODAY)).toEqual({
      granularity: "day",
      anchor: "2026-08-22",
      day: "2026-08-22",
    });
  });
});
