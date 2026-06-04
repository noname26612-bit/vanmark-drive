// Иконка типа задачи по имени lucide (из справочника). Неизвестное имя → пакет по умолчанию.
import {
  Truck,
  PackageMinus,
  PackageCheck,
  Warehouse,
  Package,
  Wrench,
  RefreshCw,
  PackagePlus,
  ShoppingCart,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  "package-minus": PackageMinus,
  "package-check": PackageCheck,
  warehouse: Warehouse,
  package: Package,
  wrench: Wrench,
  replace: RefreshCw,
  "package-plus": PackagePlus,
  "shopping-cart": ShoppingCart,
  ellipsis: MoreHorizontal,
};

export function TypeIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || Package;
  return <Icon className={className} aria-hidden />;
}
