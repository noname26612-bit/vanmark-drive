import { Badge } from "@/components/ui/badge";
import { isHeadKind } from "@/domain/machine-status";
import {
  EQUIPMENT_KIND_SHORT,
  MACHINE_CATEGORY_SHORT,
  MACHINE_STATUS_BADGE,
  MACHINE_STATUS_LABEL,
} from "@/lib/machine-ui";
import type { EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";

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

/**
 * Метки категорий — всегда нейтральный графит: категория не состояние, подсвечивать нечего.
 *
 * Категорий у станка может быть несколько (20.08.2026), и рисуем мы их отдельными метками, а не
 * одной склеенной строкой: «Продажа» и «Аренда» рядом читаются с одного взгляда, а «Продажа +
 * Аренда» в одной рамке выглядит как название третьей, несуществующей категории.
 */
export function MachineCategoryBadge({ categories }: { categories: MachineCategory[] }) {
  return (
    <>
      {categories.map((c) => (
        <Badge key={c} className="border border-slate-300 text-slate-600">
          {MACHINE_CATEGORY_SHORT[c]}
        </Badge>
      ))}
    </>
  );
}

/**
 * Метка вида — только у комплектующих: «Листогиб» на каждой строке раздела «Листогибы» (и
 * «Фальцепрокатник» в своём разделе) был бы шумом. Головной вид узнаётся по самому разделу.
 */
export function MachineKindBadge({ kind }: { kind: EquipmentKind }) {
  if (isHeadKind(kind)) return null;
  return (
    <Badge className="border border-slate-300 text-slate-600">{EQUIPMENT_KIND_SHORT[kind]}</Badge>
  );
}
