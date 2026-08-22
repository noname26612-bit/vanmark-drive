import Link from "next/link";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "green" | "amber" | "red" | "muted";

// Плашка всегда нейтральная белая, цвет несёт ТОЛЬКО число (ui-guidelines: цвет = смысл).
// Красный — «сорвано», янтарный — «требует действия сейчас», зелёный — «в порядке».
const NUM_TONE: Record<Tone, string> = {
  neutral: "text-slate-900",
  green: "text-green-600",
  amber: "text-amber-700",
  red: "text-red-600",
  muted: "text-slate-400",
};

/**
 * Числовая плашка «значение + подпись» — общий примитив «Управления» (плашки «Требует внимания»)
 * и Сводки (плитки «Итого»). Раньше эта вёрстка жила копиями на доске и в Сводке и расходилась
 * в мелочах; здесь она одна.
 *
 * Плашка может быть ссылкой (href), кнопкой (onClick) или просто числом — тег выбирается сам.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  href,
  onClick,
  active,
  testId,
  className,
}: {
  label: string;
  value: string | number;
  /** Строка под числом: «было 12», «за 3 дня» — контекст, без которого число не читается. */
  hint?: string | null;
  tone?: Tone;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  testId?: string;
  className?: string;
}) {
  const cls = cn(
    "flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left",
    (href || onClick) && "transition-colors hover:bg-slate-50",
    active && "border-slate-400 bg-slate-50",
    className,
  );
  const body = (
    <>
      <span className={cn("text-xl font-semibold tabular-nums", NUM_TONE[tone])}>{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
      {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cls} data-testid={testId}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} data-testid={testId} aria-pressed={active}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}
