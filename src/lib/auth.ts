// Auth.js v5 (NextAuth) — Credentials-провайдер, JWT-сессия в httpOnly-cookie (ARCHITECTURE §6).
// Личность и роль кладём в токен при входе и переносим в сессию — без похода в БД на каждый запрос.
// Вся проверка учётки и брутфорс-гард — в authorize (единственный путь проверки пароля, покрывает
// и форму, и прямые обращения к /api/auth).
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { checkLock, recordFailure, recordSuccess } from "@/domain/login-throttle";
import type { Role } from "@/domain/roles";

// Ошибка превышения лимита попыток — отдельный код, чтобы UI мог отличить от «неверный пароль».
class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

// Хэш-болванка для выравнивания времени ответа, когда логина нет в БД: argon2 выполняется
// всегда, чтобы по задержке нельзя было перечислять существующие логины. Считаем один раз.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("nonexistent-user-timing-equalizer");
  return dummyHashPromise;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true, // self-hosted (Caddy), не Vercel — доверяем Host
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        login: { label: "Логин", type: "text" },
        password: { label: "Пароль", type: "password" },
      },
      authorize: async (credentials) => {
        const login = typeof credentials?.login === "string" ? credentials.login.trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!login || !password) return null;

        // Брутфорс-гард: если логин уже заблокирован — даже не трогаем БД.
        if (checkLock(login).locked) {
          throw new RateLimitedError();
        }

        const user = await prisma.user.findUnique({
          where: { login: login.toLowerCase() },
        });

        // argon2 выполняется и для несуществующего логина (выравнивание времени).
        const passwordOk = await verifyPassword(
          user?.passwordHash ?? (await getDummyHash()),
          password,
        );

        const ok = user !== null && user.isActive && user.canLogin && passwordOk;
        if (!ok || user === null) {
          recordFailure(login);
          return null;
        }

        recordSuccess(login);
        return { id: user.id, login: user.login, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    // При входе (есть user) переносим id/login/role в токен.
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id ?? "";
        token.login = user.login;
        token.role = user.role;
      }
      return token;
    },
    // Из токена — в сессию, доступную серверным компонентам через auth().
    // JWT в @auth/core типизирован как Record<string, unknown>, поэтому наши поля
    // читаем через выверенный каст (значения кладём сами в jwt-колбэке выше) —
    // это «обоснованный unknown-парсинг» из CLAUDE.md.
    session({ session, token }) {
      const t = token as { uid?: string; login?: string; role?: Role };
      if (t.uid && t.login && t.role) {
        session.user.id = t.uid;
        session.user.login = t.login;
        session.user.role = t.role;
      }
      return session;
    },
  },
});
