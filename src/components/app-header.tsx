// Шапка приложения: имя пользователя, роль и выход. Используется во всех ролевых layout'ах.
import { logout } from "@/app/actions";
import { type Role, roleLabel } from "@/domain/roles";

export function AppHeader({
  name,
  role,
  position,
}: {
  name?: string | null;
  role: Role;
  position?: string | null;
}) {
  // Должность (position) приоритетна над подписью по роли: Михаил — «Директор» при правах ADMIN.
  const subtitle = position?.trim() || roleLabel(role);
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium text-neutral-900">{name ?? "—"}</span>
        <span className="text-xs text-neutral-500">{subtitle}</span>
      </div>
      <form action={logout}>
        <button
          type="submit"
          className="rounded-md px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          Выйти
        </button>
      </form>
    </header>
  );
}
