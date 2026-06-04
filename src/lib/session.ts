// Серверные guard'ы для страниц (аналог requireUser/requireRole из ARCHITECTURE §6).
// Личность берём ТОЛЬКО из сессии (auth()), никогда из запроса. Для API-эндпоинтов на
// следующих этапах сделаем отдельные хелперы, возвращающие 401/403 вместо редиректа.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { type Role, homeForRole } from "@/domain/roles";

export type SessionUser = {
  id: string;
  login: string;
  role: Role;
  name?: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const { id, login, role, name } = session.user;
  return { id, login, role, name };
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
