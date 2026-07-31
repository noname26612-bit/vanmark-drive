"use client";
// Ошибка рендера водительских экранов (/m…): крупная кнопка «Обновить» в зоне большого пальца —
// водитель в поле должен выйти из сбоя сам, без звонка диспетчеру (жалобы 31.07 «висит и всё»).
export default function DriverError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-6 py-12 text-center">
      <p className="text-lg font-semibold text-neutral-900">Что-то сломалось</p>
      <p className="mt-2 text-[15px] text-neutral-600">
        Обновите экран. Если не поможет — закройте приложение и откройте заново.
      </p>
      <button
        type="button"
        onClick={() => {
          reset();
          window.location.reload();
        }}
        className="mt-6 flex h-14 w-full items-center justify-center rounded-xl bg-indigo-600 text-lg font-semibold text-white active:bg-indigo-700"
      >
        Обновить
      </button>
    </div>
  );
}
