"use client";
import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { useInstallPrompt } from "@/hooks/use-install-prompt";

// Ненавязчивая полоса: «Установить приложение» и «Включить уведомления» (Этап 5).
// Показывается только когда есть что предложить; после установки/подписки сворачивается.
//
// withPush=false — не звать к уведомлениям там, где их не шлют: предложение «включить уведомления»
// без единой рассылки было бы обещанием, которого система не выполняет.
// С 18.08.2026 таких мест не осталось: дни рождения коллег (PRD §18) приходят всем сотрудникам со
// входом, включая менеджера-сервисника, — поэтому кнопку показываем везде. Проп оставлен на случай
// нового раздела, где рассылок опять не будет.
export function PwaControls({ withPush = true }: { withPush?: boolean }) {
  const push = usePushSubscription();
  const install = useInstallPrompt();

  const showInstall = install.canInstall;
  const showEnable = withPush && push.state === "unsubscribed";
  const showDenied = withPush && push.state === "denied";

  if (!showInstall && !showEnable && !showDenied) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2">
      {showInstall && (
        <Button variant="secondary" className="h-9" onClick={install.promptInstall}>
          Установить приложение
        </Button>
      )}
      {showEnable && (
        <Button
          variant="secondary"
          className="h-9"
          disabled={push.busy}
          onClick={push.subscribe}
        >
          {push.busy ? "Включаем…" : "Включить уведомления"}
        </Button>
      )}
      {showDenied && (
        <span className="text-xs text-neutral-500">
          Уведомления запрещены — разрешите их в настройках браузера
        </span>
      )}
    </div>
  );
}
