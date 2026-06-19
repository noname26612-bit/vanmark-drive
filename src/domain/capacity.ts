// Ёмкость и оценка времени задачи (Фаза 2, PRD §14, ARCHITECTURE §4б).
// Чистое ядро без БД и сети: расстояние по прямой, выбор коэффициента пробок, время в пути,
// итоговая оценка. Геокодер (src/lib/geocode.ts) и чтение настроек (capacity-service.ts) — снаружи.
// Здесь только арифметика — она и покрыта юнит-тестами (src/domain/capacity.test.ts).

export type LatLng = { lat: number; lng: number };

// Окно времени суток с коэффициентом пробок (PRD §14.3). Границы — минуты от полуночи:
// from включительно, to исключая. factorPercent: 100 = ×1.0, 140 = ×1.4.
export type TrafficWindow = {
  fromMinutes: number;
  toMinutes: number;
  factorPercent: number;
};

// Параметры расчёта дороги (из CapacitySettings).
export type CapacityParams = {
  avgSpeedKmh: number;
  detourPercent: number;
  countReturnTrip: boolean;
};

const EARTH_RADIUS_KM = 6371;
const DEFAULT_FACTOR_PERCENT = 100; // запасной коэффициент, если окно не найдено
const NOON_MINUTES = 12 * 60; // «дневной» якорь, когда у задачи нет времени выезда

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Расстояние по прямой между двумя точками (гаверсинус), км.
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Разбор «HH:MM» → минуты от полуночи. Невалидно/пусто → null.
export function parseHhMm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

// Коэффициент пробок (%) для времени выезда. Нет времени/невалидно → дневной (по полудню);
// окно не найдено → 100%. Окна не обязаны покрывать сутки целиком — пробел = 100%.
export function trafficFactorPercent(
  timeFrom: string | null | undefined,
  windows: TrafficWindow[],
): number {
  const at = parseHhMm(timeFrom) ?? NOON_MINUTES;
  const win = windows.find((w) => at >= w.fromMinutes && at < w.toMinutes);
  return win?.factorPercent ?? DEFAULT_FACTOR_PERCENT;
}

// Время в пути база→точка (мин). Нет координат точки или некорректная скорость → null
// (дорогу не учитываем — оценка пойдёт по одной норме работы).
export function travelMinutes(
  base: LatLng,
  point: LatLng | null,
  params: CapacityParams,
  trafficPercent: number,
): number | null {
  if (!point) return null;
  if (params.avgSpeedKmh <= 0) return null;
  const straightKm = haversineKm(base, point);
  const roadKm = straightKm * (params.detourPercent / 100) * (params.countReturnTrip ? 2 : 1);
  const freeHours = roadKm / params.avgSpeedKmh;
  return freeHours * 60 * (trafficPercent / 100);
}

export type EstimateInput = {
  onSiteMinutes: number;
  base: LatLng;
  point: LatLng | null; // null — адрес не геокодирован
  timeFrom: string | null | undefined;
  params: CapacityParams;
  windows: TrafficWindow[];
};

export type EstimateResult = {
  onSiteMinutes: number; // норма работы на объекте
  travelMinutes: number | null; // дорога; null — координат нет, дорога не учтена
  totalMinutes: number; // итог (работа + дорога; дорога считается за 0, если null)
  trafficPercent: number; // применённый коэффициент пробок
};

// Итоговая оценка задачи: норма работы + дорога. Без координат — только норма (дорога не учтена).
// Результат целочисленный (минуты округляются).
export function estimateTask(input: EstimateInput): EstimateResult {
  const trafficPercent = trafficFactorPercent(input.timeFrom, input.windows);
  const travel = travelMinutes(input.base, input.point, input.params, trafficPercent);
  const onSite = Math.max(0, Math.round(input.onSiteMinutes));
  const total = Math.round(onSite + (travel ?? 0));
  return {
    onSiteMinutes: onSite,
    travelMinutes: travel === null ? null : Math.round(travel),
    totalMinutes: total,
    trafficPercent,
  };
}

// Человекочитаемая длительность: 95 → «1 ч 35 мин», 30 → «30 мин», 120 → «2 ч».
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} мин`;
  if (rest === 0) return `${h} ч`;
  return `${h} ч ${rest} мин`;
}
