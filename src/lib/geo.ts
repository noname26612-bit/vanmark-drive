// Гео-метка для смены статуса (PRD §5): запрашиваем координаты ОДИН раз в момент действия.
// Постоянного трекинга нет. Никогда не бросает и не блокирует: нет разрешения/сети/таймаут — null,
// смена статуса всё равно проходит (координаты опциональны и на сервере, и в матрице).
export type Coords = { lat: number; lng: number };

export function getPositionOnce(): Promise<Coords | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null), // denied / unavailable / timeout — спокойно работаем без метки
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 },
    );
  });
}
