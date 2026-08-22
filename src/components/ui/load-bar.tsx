import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format-duration";

/**
 * Полоса загрузки смены: зелёным — «в работе», серым — «простой» (та же пара цветов, что в блоке
 * «Смены водителей» на доске). Легенда обязательна: без подписи две заливки читаются как «план и
 * факт» или «сделано и осталось» — на доске это выяснилось сразу, в Сводке полоса стояла без неё.
 *
 * Смен в периоде не было (`percent === null`) — полоса не рисуется вовсе: пустая шкала выглядит как
 * «ноль работы», хотя работать было негде.
 */
export function LoadBar({
  percent,
  workedMinutes,
  idleMinutes,
  legend = true,
  className,
}: {
  percent: number | null;
  workedMinutes: number;
  idleMinutes: number;
  legend?: boolean;
  className?: string;
}) {
  if (percent === null) {
    return <span className={cn("text-xs text-slate-400", className)}>смен нет</span>;
  }
  const total = workedMinutes + idleMinutes;
  // Доли считаем от суммы, а не от percent: при загрузке >100% (кривые данные) полоса иначе
  // «переполнялась» бы и молча обрезала простой.
  const workedPct = total > 0 ? Math.round((workedMinutes / total) * 100) : 0;
  const idlePct = total > 0 ? 100 - workedPct : 0;
  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded bg-slate-100">
        <div className="bg-green-500" style={{ width: `${workedPct}%` }} />
        <div className="bg-slate-300" style={{ width: `${idlePct}%` }} />
      </div>
      {legend ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-green-500 align-middle" />
            {formatDuration(workedMinutes)}
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-300 align-middle" />
            {formatDuration(idleMinutes)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
