import { Badge } from "@/components/ui/badge";
import {
  MACHINE_CATEGORY_SHORT,
  MACHINE_STATUS_BADGE,
  MACHINE_STATUS_LABEL,
} from "@/lib/machine-ui";
import type { MachineCategory, MachineStatus } from "@/generated/prisma/enums";

/** Метка состояния станка. Цвета — из ui-guidelines (см. machine-ui). */
export function MachineStatusBadge({
  status,
  size = "sm",
}: {
  status: MachineStatus;
  size?: "sm" | "md";
}) {
  return (
    <Badge className={MACHINE_STATUS_BADGE[status]} size={size}>
      {MACHINE_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Метка категории — всегда нейтральный графит: категория не состояние, подсвечивать нечего. */
export function MachineCategoryBadge({ category }: { category: MachineCategory }) {
  return (
    <Badge className="border border-slate-300 text-slate-600">
      {MACHINE_CATEGORY_SHORT[category]}
    </Badge>
  );
}
