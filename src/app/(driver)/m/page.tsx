// Заглушка этапа 1. Экран водителя «Мои задачи» и цепочка статусов — этап 3.
export default function DriverHomePage() {
  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold text-neutral-900">Мои задачи</h1>
      <p className="mt-2 text-base leading-relaxed text-neutral-500">
        Здесь будет список задач на сегодня: крупные карточки, кнопки «Навигатор» и «Позвонить»,
        одна большая кнопка следующего статуса. Сейчас это заглушка — экран водителя делаем на этапе 3.
      </p>
    </main>
  );
}
