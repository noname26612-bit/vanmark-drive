"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { checkLock, type LockState } from "@/domain/login-throttle";

export type LoginState = { error?: string };

function lockMessage(lock: Extract<LockState, { locked: true }>): string {
  const minutes = Math.max(1, Math.ceil(lock.retryAfterMs / 60_000));
  return `Слишком много попыток входа. Повторите примерно через ${minutes} мин.`;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!login || !password) {
    return { error: "Введите логин и пароль." };
  }

  // Дружелюбное сообщение о блокировке (счётчик ведёт authorize; здесь только читаем).
  const lock = checkLock(login);
  if (lock.locked) {
    return { error: lockMessage(lock) };
  }

  try {
    await signIn("credentials", { login, password, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) {
      // Возможно, именно эта попытка стала десятой — перечитываем состояние.
      const after = checkLock(login);
      return { error: after.locked ? lockMessage(after) : "Неверный логин или пароль." };
    }
    throw error; // NEXT_REDIRECT при успешном входе пробрасываем дальше
  }

  return {};
}
