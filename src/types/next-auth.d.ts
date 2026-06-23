// Расширяем типы Auth.js: в сессии держим id/login/role нашего пользователя.
// JWT не расширяем здесь: в @auth/core он объявлен как Record<string, unknown> и
// declaration-merging до колбэков не доходит, поэтому свои поля токена читаем
// через выверенный каст в src/lib/auth.ts (см. комментарий там).
import type { DefaultSession } from "next-auth";
import type { Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role: Role;
    login: string;
    position?: string | null; // должность для отображения (напр. «Директор»), не право
  }

  interface Session {
    user: {
      id: string;
      login: string;
      role: Role;
      position?: string | null; // должность для отображения в шапке; null → подпись по роли
    } & DefaultSession["user"];
  }
}
