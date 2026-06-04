// Заглушка этапа 1. Экраны диспетчера («Сегодня», «Все задачи», карточка) — этап 2.
export default function BoardPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Доска диспетчера</h1>
      <p className="mt-2 max-w-prose text-neutral-500">
        Здесь появится экран «Сегодня»: задачи по водителям, колонка «Не назначено»,
        назначение перетаскиванием и счётчики. Сейчас это заглушка — доску делаем на этапе 2.
      </p>
    </main>
  );
}
