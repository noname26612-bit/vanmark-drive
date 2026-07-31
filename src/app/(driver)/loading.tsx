// Промежуточный экран навигации по водительским страницам: видимый прогресс вместо застывшего
// предыдущего экрана (на медленной сети переход выглядел как «зависло»).
export default function DriverLoading() {
  return <p className="p-6 text-center text-base text-neutral-500">Загрузка…</p>;
}
