"use client";
// Ошибка рендера страницы (внутри корневого layout). Даёт водителю/диспетчеру кнопку вместо белого
// экрана: перезагрузка подтягивает свежие чанки и почти всегда лечит сбой гидратации на плохой сети.
export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-6 py-12 text-center">
      <p className="text-lg font-semibold text-neutral-900">Что-то сломалось</p>
      <p className="mt-2 text-[15px] text-neutral-600">Обновите экран — обычно этого достаточно.</p>
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
