// Автоперезагрузка вкладки при активации НОВОГО service worker (после деплоя). Инцидент 07.07.2026:
// открытое приложение водителя осталось на старом BUILD_ID — новый SW (skipWaiting + clients.claim)
// удалил кэш прошлой сборки, а старый клиент при переходе на карточку задачи запросил уже удалённые
// с сервера чанки `/_next/static/...` → 404 → браузер показал «This page couldn't load», и водитель
// «завис» (диспетчер видел простой). Лечится тем, что при СМЕНЕ контроллера мы перезагружаем страницу
// на свежий HTML (page.tsx = force-dynamic, no-store) → новый BUILD_ID и консистентные чанки.
//
// Логика вынесена из компонента в чистую функцию, чтобы покрыть её unit-тестом (окружение node).

/** Минимальный контракт ServiceWorkerContainer, достаточный для отслеживания смены контроллера. */
export type ControllerChangeTarget = {
  controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
};

/**
 * Подписывается на `controllerchange` и перезагружает страницу при активации нового SW.
 *
 * Тонкости, ради которых нужна отдельная функция:
 *  - Reload только если контроллер УЖЕ был на момент подписки. Первый визит (контроллера ещё нет) —
 *    первая активация SW НЕ должна вызывать reload: это не обновление, а первичная установка, иначе
 *    каждый первый заход ловил бы лишнюю перезагрузку.
 *  - Флаг `done` гасит повторный reload (событие может прийти не один раз).
 *  - На /login не перезагружаем: там своя навигация и незакоммиченный ввод пароля.
 *
 * @returns функция отписки (для cleanup в useEffect).
 */
export function watchControllerChange(
  target: ControllerChangeTarget,
  reload: () => void,
  isLoginPath: () => boolean,
): () => void {
  if (!target.controller) return () => {}; // первый визит: обновления быть не может — не подписываемся
  let done = false;
  const onChange = () => {
    if (done) return;
    if (isLoginPath()) return; // на форме логина reload собьёт ввод — пропускаем (без залипания флага)
    done = true;
    reload();
  };
  target.addEventListener("controllerchange", onChange);
  return () => target.removeEventListener("controllerchange", onChange);
}
