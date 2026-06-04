// Маршрут Auth.js (вход/выход/сессия). Node-рантайм: authorize ходит в Prisma и argon2.
import { handlers } from "@/lib/auth";

export const runtime = "nodejs";
export const { GET, POST } = handlers;
