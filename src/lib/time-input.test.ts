import { describe, it, expect } from "vitest";
import { parseTimeInput, isCompleteTime } from "./time-input";

describe("parseTimeInput", () => {
  it("разбирает время с разделителем", () => {
    expect(parseTimeInput("16:30")).toBe("16:30");
    expect(parseTimeInput("16.30")).toBe("16:30");
    expect(parseTimeInput("16-30")).toBe("16:30");
    expect(parseTimeInput("16 30")).toBe("16:30");
    expect(parseTimeInput("9:5")).toBe("09:05");
  });

  it("разбирает набор цифрами — то, ради чего всё затевалось", () => {
    expect(parseTimeInput("1630")).toBe("16:30");
    expect(parseTimeInput("0730")).toBe("07:30");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("16")).toBe("16:00");
    expect(parseTimeInput("00")).toBe("00:00");
  });

  it("понимает «сейчас», когда текущее время передано", () => {
    expect(parseTimeInput("сейчас", "18:45")).toBe("18:45");
    expect(parseTimeInput("Сейчас", "07:05")).toBe("07:05");
    expect(parseTimeInput("сейчас")).toBeNull(); // без опоры на now — не гадаем
  });

  it("не пропускает мусор и невозможное время", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("абв")).toBeNull();
    expect(parseTimeInput("25:00")).toBeNull();
    expect(parseTimeInput("12:75")).toBeNull();
    expect(parseTimeInput("2500")).toBeNull();
    expect(parseTimeInput("1275")).toBeNull();
    expect(parseTimeInput("12345")).toBeNull();
    expect(parseTimeInput("12:30:45")).toBeNull();
  });

  it("терпим к пробелам вокруг", () => {
    expect(parseTimeInput("  07:45  ")).toBe("07:45");
  });
});

describe("isCompleteTime", () => {
  it("узнаёт готовое ЧЧ:ММ (по нему поле коммитит на лету)", () => {
    expect(isCompleteTime("07:45")).toBe(true);
    expect(isCompleteTime("23:59")).toBe(true);
    expect(isCompleteTime("7:45")).toBe(false);
    expect(isCompleteTime("24:00")).toBe(false);
    expect(isCompleteTime("1630")).toBe(false);
  });
});
