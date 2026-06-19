// Геокодер адреса (Фаза 2, ARCHITECTURE §4б). Server-only: вызывается из доменного слоя при
// создании/правке адреса задачи и превращает адрес-текст в координаты для оценки дороги (PRD §14).
// Провайдер выбирается через env GEOCODER_PROVIDER:
//   nominatim (по умолчанию) — OpenStreetMap, бесплатно, без ключа (для dev и старта);
//   dadata    — лучшее качество по РФ-адресам, нужен ключ DADATA_API_KEY + DADATA_SECRET (для прода);
//   none      — геокодирование выключено.
// Любой сбой/таймаут/отсутствие ключа → null (мягкий откат): оценка тогда считается без дороги,
// фича не падает. Координаты кэшируются в Task.lat/lng, поэтому повторных вызовов на один адрес нет.
import type { LatLng } from "@/domain/capacity";

const TIMEOUT_MS = 5000;
const MIN_ADDRESS_LEN = 4;

type Provider = "nominatim" | "dadata" | "none";

function provider(): Provider {
  const p = (process.env.GEOCODER_PROVIDER || "nominatim").toLowerCase();
  if (p === "dadata" || p === "none") return p;
  return "nominatim";
}

function withTimeout(): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
}

// Парсинг и валидация координат из ответа провайдера (значения приходят строкой или числом).
function validCoords(lat: unknown, lng: unknown): LatLng | null {
  const la = typeof lat === "string" ? Number(lat) : lat;
  const ln = typeof lng === "string" ? Number(lng) : lng;
  if (typeof la !== "number" || typeof ln !== "number") return null;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

async function geocodeNominatim(address: string): Promise<LatLng | null> {
  const ua = process.env.GEOCODER_USER_AGENT || "vanmark-drive/1.0 (dispatch service)";
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ru");
  const { signal, cancel } = withTimeout();
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "ru" }, signal });
    if (!res.ok) return null;
    // Ответ Nominatim — массив; нас интересует первый результат. Тип неизвестен — парсим как unknown.
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as { lat?: unknown; lon?: unknown };
    return validCoords(first.lat, first.lon);
  } catch {
    return null; // сеть/таймаут/невалидный JSON — мягкий откат
  } finally {
    cancel();
  }
}

async function geocodeDadata(address: string): Promise<LatLng | null> {
  const apiKey = process.env.DADATA_API_KEY;
  const secret = process.env.DADATA_SECRET;
  if (!apiKey || !secret) return null; // нет ключа → откат на «без дороги»
  const { signal, cancel } = withTimeout();
  try {
    const res = await fetch("https://cleaner.dadata.ru/api/v1/clean/address", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${apiKey}`,
        "X-Secret": secret,
      },
      body: JSON.stringify([address]),
      signal,
    });
    if (!res.ok) return null;
    // Ответ Dadata clean — массив объектов с geo_lat/geo_lon. Тип неизвестен — парсим как unknown.
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as { geo_lat?: unknown; geo_lon?: unknown };
    return validCoords(first.geo_lat, first.geo_lon);
  } catch {
    return null;
  } finally {
    cancel();
  }
}

// Геокодировать адрес → координаты или null (мягкий откат). Пустой/слишком короткий адрес или
// провайдер none → null без обращения к сети.
export async function geocodeAddress(address: string | null | undefined): Promise<LatLng | null> {
  const q = (address || "").trim();
  if (q.length < MIN_ADDRESS_LEN) return null;
  switch (provider()) {
    case "none":
      return null;
    case "dadata":
      return geocodeDadata(q);
    default:
      return geocodeNominatim(q);
  }
}
