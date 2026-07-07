import type { TaskStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { STATUS_BADGE, STATUS_LABEL, isStatusBadgeHidden } from "@/lib/task-ui";
import { Badge } from "@/components/ui/badge";

/**
 * Плашка статуса задачи — единый компонент для всех экранов (доска, карточки, водитель, планирование,
 * «Все задачи»). Сам решает, показывать ли метку: для скрытых статусов («Назначена») возвращает null,
 * чтобы не шуметь (решение Артёма 24.06). Цвета — из STATUS_BADGE (источник правды task-ui.ts).
 */
export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  if (isStatusBadgeHidden(status)) return null;
  // «В работе» показываем крупнее (size md) — активная задача должна бросаться в глаза на доске и у
  // водителя (решение Артёма 07.07). Остальные статусы — стандартный размер.
  const size = status === "IN_PROGRESS" ? "md" : "sm";
  return (
    <Badge size={size} className={cn(STATUS_BADGE[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
