import { describe, it, expect } from "vitest";
import {
  haversineKm,
  parseHhMm,
  trafficFactorPercent,
  travelMinutes,
  estimateTask,
  formatMinutes,
  type TrafficWindow,
  type LatLng,
} from "./capacity";

// Дефолтные окна пробок (PRD §14.3) + ночь 00:00–04:00. from включ., to исключая.
const WINDOWS: TrafficWindow[] = [
  { fromMinutes: 0, toMinutes: 240, factorPercent: 100 }, // 00:00–04:00
  { fromMinutes: 240, toMinutes: 420, factorPercent: 100 }, // 04:00–07:00
  { fromMinutes: 420, toMinutes: 480, factorPercent: 130 }, // 07:00–08:00
  { fromMinutes: 480, toMinutes: 570, factorPercent: 140 }, // 08:00–09:30
  { fromMinutes: 570, toMinutes: 630, factorPercent: 130 }, // 09:30–10:30
  { fromMinutes: 630, toMinutes: 960, factorPercent: 120 }, // 10:30–16:00
  { fromMinutes: 960, toMinutes: 1020, factorPercent: 130 }, // 16:00–17:00
  { fromMinutes: 1020, toMinutes: 1140, factorPercent: 140 }, // 17:00–19:00
  { fromMinutes: 1140, toMinutes: 1200, factorPercent: 120 }, // 19:00–20:00
  { fromMinutes: 1200, toMinutes: 1440, factorPercent: 100 }, // 20:00–24:00
];

const ORIGIN: LatLng = { lat: 0, lng: 0 };
const PARAMS = { avgSpeedKmh: 50, detourPercent: 110, countReturnTrip: false };

describe("capacity — haversineKm", () => {
  it("одна и та же точка → 0", () => {
    expect(haversineKm(ORIGIN, ORIGIN)).toBe(0);
  });

  it("1° по долготе на экваторе ≈ 111 км", () => {
    expect(haversineKm(ORIGIN, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
  });

  it("1° по широте ≈ 111 км", () => {
    expect(haversineKm(ORIGIN, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
  });
});

describe("capacity — parseHhMm", () => {
  it("валидные значения", () => {
    expect(parseHhMm("09:00")).toBe(540);
    expect(parseHhMm("9:00")).toBe(540);
    expect(parseHhMm("23:59")).toBe(1439);
    expect(parseHhMm("00:00")).toBe(0);
  });

  it("невалидные → null", () => {
    expect(parseHhMm("")).toBeNull();
    expect(parseHhMm(null)).toBeNull();
    expect(parseHhMm(undefined)).toBeNull();
    expect(parseHhMm("24:00")).toBeNull();
    expect(parseHhMm("12:60")).toBeNull();
    expect(parseHhMm("после обеда")).toBeNull();
  });
});

describe("capacity — trafficFactorPercent", () => {
  it("по времени выезда попадает в нужное окно", () => {
    expect(trafficFactorPercent("08:30", WINDOWS)).toBe(140);
    expect(trafficFactorPercent("17:30", WINDOWS)).toBe(140);
    expect(trafficFactorPercent("13:00", WINDOWS)).toBe(120);
    expect(trafficFactorPercent("03:00", WINDOWS)).toBe(100);
  });

  it("границы окон: from включительно, to исключая", () => {
    expect(trafficFactorPercent("08:00", WINDOWS)).toBe(140); // начало окна 480–570
    expect(trafficFactorPercent("09:30", WINDOWS)).toBe(130); // 570 уже в 570–630, не в 480–570
  });

  it("нет времени → дневной коэффициент (полдень)", () => {
    expect(trafficFactorPercent(null, WINDOWS)).toBe(120); // 12:00 → окно 10:30–16:00
    expect(trafficFactorPercent("после обеда", WINDOWS)).toBe(120);
  });

  it("окно не найдено → 100%", () => {
    expect(trafficFactorPercent("12:00", [])).toBe(100);
  });
});

describe("capacity — travelMinutes", () => {
  it("нет координат точки → null (дорога не учтена)", () => {
    expect(travelMinutes(ORIGIN, null, PARAMS, 100)).toBeNull();
  });

  it("нулевая/некорректная скорость → null", () => {
    expect(travelMinutes(ORIGIN, { lat: 0, lng: 1 }, { ...PARAMS, avgSpeedKmh: 0 }, 100)).toBeNull();
  });

  it("считает по прямой × петляние ÷ скорость × пробки", () => {
    // 111.195 км × 1.1 ÷ 50 ч × 60 = 146.78 мин при пробках 100%
    expect(travelMinutes(ORIGIN, { lat: 0, lng: 1 }, PARAMS, 100)).toBeCloseTo(146.78, 1);
    // пробки 140% → ×1.4
    expect(travelMinutes(ORIGIN, { lat: 0, lng: 1 }, PARAMS, 140)).toBeCloseTo(205.49, 1);
  });

  it("обратная дорога удваивает путь", () => {
    const oneWay = travelMinutes(ORIGIN, { lat: 0, lng: 1 }, PARAMS, 100)!;
    const roundTrip = travelMinutes(ORIGIN, { lat: 0, lng: 1 }, { ...PARAMS, countReturnTrip: true }, 100)!;
    expect(roundTrip).toBeCloseTo(oneWay * 2, 5);
  });
});

describe("capacity — estimateTask", () => {
  it("без координат → только норма работы, дорога null", () => {
    const r = estimateTask({
      onSiteMinutes: 90,
      base: ORIGIN,
      point: null,
      timeFrom: "08:30",
      params: PARAMS,
      windows: WINDOWS,
    });
    expect(r.travelMinutes).toBeNull();
    expect(r.totalMinutes).toBe(90);
    expect(r.onSiteMinutes).toBe(90);
  });

  it("с координатами → норма + дорога с коэффициентом окна", () => {
    const r = estimateTask({
      onSiteMinutes: 90,
      base: ORIGIN,
      point: { lat: 0, lng: 1 },
      timeFrom: "13:00", // дневное окно ×1.2
      params: PARAMS,
      windows: WINDOWS,
    });
    expect(r.trafficPercent).toBe(120);
    // дорога 146.78 × 1.2 = 176.13 → округление 176; итог 90 + 176 = 266
    expect(r.travelMinutes).toBe(176);
    expect(r.totalMinutes).toBe(266);
  });
});

describe("capacity — formatMinutes", () => {
  it("форматирует часы и минуты по-русски", () => {
    expect(formatMinutes(95)).toBe("1 ч 35 мин");
    expect(formatMinutes(30)).toBe("30 мин");
    expect(formatMinutes(120)).toBe("2 ч");
    expect(formatMinutes(0)).toBe("0 мин");
  });
});
