// Хелперы для route handlers: личность из сессии (никогда из тела), проверка роли,
// маппинг доменных ошибок в { error: { code, message } } (ARCHITECTURE §6–7).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fail } from "@/lib/api";
import { DomainError, Errors } from "@/domain/errors";
import { isDispatcherRole } from "@/domain/task-status";
import type { Role } from "@/domain/roles";

export type ApiUser = { id: string; login: string; role: Role; name?: string | null };

export async function requireApiUser(): Promise<ApiUser> {
  const session = await auth();
  if (!session?.user?.id) throw Errors.unauthorized();
  const { id, login, role, name } = session.user;
  return { id, login, role, name };
}

export async function requireDispatcher(): Promise<ApiUser> {
  const user = await requireApiUser();
  if (!isDispatcherRole(user.role)) throw Errors.forbidden();
  return user;
}

export async function requireAdmin(): Promise<ApiUser> {
  const user = await requireApiUser();
  if (user.role !== "ADMIN") throw Errors.forbidden();
  return user;
}

/** Единый маппинг ошибок: доменные — со своим кодом/статусом, прочие — 500 без утечек. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof DomainError) {
    return NextResponse.json(fail(e.code, e.message), { status: e.httpStatus });
  }
  console.error("API error:", e);
  return NextResponse.json(fail("INTERNAL", "Внутренняя ошибка"), { status: 500 });
}

/** Безопасно прочитать JSON-тело (пустое/битое → {}). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
