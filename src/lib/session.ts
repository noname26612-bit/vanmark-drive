// Серверные guard'ы для страниц (аналог requireUser/requireRole из ARCHITECTURE §6).
// Личность берём ТОЛЬКО из сессии (auth()), никогда из запроса. Для API-эндпоинтов на
// следующих этапах сделаем отдельные хелперы, возвращающие 401/403 вместо редиректа.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { type Role, homeForRole } from "@/domain/roles";
import { isMachineRole } from "@/domain/machine-access";
import { hasEquipmentAccess } from "@/domain/users";

export type SessionUser = {
  id: string;
  login: string;
  role: Role;
  name?: string | null;
  position?: string | null; // должность для отображения (напр. «Директор»); null → подпись по роли
};

/** Пользователь разделов оборудования: к сессии добавлен допуск, прочитанный из БД. */
export type EquipmentSessionUser = SessionUser & { equipmentAccess: boolean };

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const { id, login, role, name, position } = session.user;
  return { id, login, role, name, position };
}

/** Требует авторизации; иначе — на страницу входа. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Требует конкретной роли; чужая роль уходит на свой стартовый экран. */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) redirect(homeForRole(user.role));
  return user;
}

/** Требует одной из ролей (например, экраны диспетчера доступны и админу). */
export async function requireAnyRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

/**
 * Guard разделов оборудования: роль из белого списка (менеджер-сервисник, диспетчер, админ) ИЛИ
 * персональный флаг из БД (Николай, Александр — 15.08.2026). Недопущенного уводим на его стартовый
 * экран, как и любой чужой раздел. Флаг читаем из БД, а не из сессии: см. domain/machine-access.
 */
export async function requireEquipmentUser(): Promise<EquipmentSessionUser> {
  const user = await requireUser();
  if (isMachineRole(user.role)) return { ...user, equipmentAccess: false };
  const equipmentAccess = await hasEquipmentAccess(user.id);
  if (!equipmentAccess) redirect(homeForRole(user.role));
  return { ...user, equipmentAccess: true };
}
